import { renderVerifiedDocument } from "../adapters/document_renderer";
import { buildSessionMemoryContext, createEmptyMemoryVault } from "../domain/memory";
import type { FormSession, MemoryVault } from "../domain/schemas";
import { createFormSession, verifySession } from "../domain/session";
import { buildFinalVerification, type SemanticVerificationRun } from "../domain/verification";
import { InterviewToolExecutor, type InterviewToolExecution } from "../server/interview_tools";
import { loadFixture, loadFixtureSource } from "../server/fixtures";
import { aggregateCompilerMetrics, evaluateCompilerForm } from "./compiler_metrics";
import { loadGoldenCompilerFixtures } from "./golden_fixtures";

const requestedRuns = Number(optionValue("--runs") ?? "5");
if (!Number.isInteger(requestedRuns) || requestedRuns < 1 || requestedRuns > 20) {
  throw new Error("--runs must be an integer from 1 through 20.");
}

const goldenFixtures = await loadGoldenCompilerFixtures();
const compilerMetrics = aggregateCompilerMetrics(goldenFixtures.map((fixture) =>
  evaluateCompilerForm(fixture.form, fixture.answerKey)
));
assert(
  compilerMetrics.fieldRecallPercent >= 95
    && compilerMetrics.requiredRecallPercent === 100
    && compilerMetrics.fabricatedFieldIds.length === 0
    && compilerMetrics.missingDependencies.length === 0,
  `Golden compiler gate failed: ${JSON.stringify(compilerMetrics)}`
);

const runs: ResilienceRunResult[] = [];
for (let index = 0; index < requestedRuns; index += 1) {
  runs.push(await runNorthStarPass(index + 1));
}

console.log(JSON.stringify({
  compiler: {
    fieldRecallPercent: compilerMetrics.fieldRecallPercent,
    requiredRecallPercent: compilerMetrics.requiredRecallPercent,
    expectedFields: compilerMetrics.expectedFields,
    fabricatedFieldCount: compilerMetrics.fabricatedFieldIds.length,
    missingDependencyCount: compilerMetrics.missingDependencies.length
  },
  runs,
  aggregate: {
    requestedRuns,
    consecutivePasses: runs.length,
    blockingFailures: 0,
    medicalNativeRenderPasses: runs.filter((run) => run.medical.renderCoveragePercent === 100).length,
    reconnectRecoveryPasses: runs.filter((run) => run.interview.reconnectedAtCompletedState).length,
    explicitMemoryPasses: runs.filter((run) => run.memory.approvedClaims === 3).length,
    safeReusePasses: runs.filter((run) => run.memory.reusedClaims === 3 && run.memory.sensitiveClaims === 0).length,
    averageDurationMs: Math.round(runs.reduce((total, run) => total + run.durationMs, 0) / runs.length)
  }
}, null, 2));

interface ResilienceRunResult {
  run: number;
  durationMs: number;
  interview: {
    toolCalls: number;
    replayDeduplicated: boolean;
    reconnectedAtCompletedState: boolean;
  };
  medical: {
    deterministicBlockers: number;
    clearSemanticFixturePassed: boolean;
    renderKind: string;
    renderCoveragePercent: number;
    sourcePreserved: boolean;
  };
  memory: {
    approvedClaims: number;
    sensitiveClaims: number;
    reusedClaims: number;
  };
}

async function runNorthStarPass(run: number): Promise<ResilienceRunResult> {
  const startedAt = performance.now();
  let toolCalls = 0;

  const medicalForm = await loadFixture("medical-intake");
  const medicalSource = await loadFixtureSource("medical-intake");
  assert(medicalSource, "The medical source fixture is unavailable.");
  let medicalSession = createFormSession(medicalForm);
  const medicalExecutor = new InterviewToolExecutor();
  let medicalVault = createEmptyMemoryVault();

  const context = executeTool(medicalExecutor, medicalSession, medicalVault, {
    callId: `run-${run}-medical-context`,
    name: "get_interview_context",
    arguments: JSON.stringify({ sessionVersion: medicalSession.version })
  });
  toolCalls += 1;
  assert(context.output.ok, "The medical interview context could not be read.");

  const medicalSaveRequest = {
    callId: `run-${run}-medical-save`,
    name: "save_answers",
    arguments: JSON.stringify({
      sessionVersion: medicalSession.version,
      answers: [
        voiceAnswer("patient_name", "Taylor Morgan"),
        voiceAnswer("date_of_birth", "1988-05-12"),
        voiceAnswer("phone", "+31 20 555 0101"),
        voiceAnswer("email", "taylor@example.test"),
        voiceAnswer("visit_reason", "Recurring headaches"),
        voiceAnswer("current_medications", "None"),
        voiceAnswer("has_allergies", true),
        voiceAnswer("allergy_details", "Penicillin - rash")
      ]
    })
  };
  const savedMedical = executeTool(medicalExecutor, medicalSession, medicalVault, medicalSaveRequest);
  toolCalls += 1;
  medicalSession = savedMedical.session;
  medicalVault = savedMedical.vault;
  assert(savedMedical.output.ok, "The medical answers could not be saved atomically.");

  const replayedMedical = executeTool(medicalExecutor, medicalSession, medicalVault, medicalSaveRequest);
  toolCalls += 1;
  assert(replayedMedical.cached && replayedMedical.session.version === medicalSession.version,
    "A repeated Realtime tool call was not safely deduplicated.");

  const finishedMedical = executeTool(medicalExecutor, medicalSession, medicalVault, {
    callId: `run-${run}-medical-finish`,
    name: "finish_interview",
    arguments: JSON.stringify({ sessionVersion: medicalSession.version })
  });
  toolCalls += 1;
  assert(finishedMedical.output.ok && finishedMedical.output.canFinish === true,
    "The completed medical interview did not pass the finish guard.");

  const reconnected = executeTool(new InterviewToolExecutor(), medicalSession, medicalVault, {
    callId: `run-${run}-medical-reconnect`,
    name: "get_interview_context",
    arguments: JSON.stringify({ sessionVersion: medicalSession.version })
  });
  toolCalls += 1;
  const reconnectContext = reconnected.output.context as {
    nextQuestion?: unknown;
    remainingQuestions?: unknown[];
    sessionVersion?: number;
  };
  const reconnectedAtCompletedState = reconnected.output.ok
    && reconnectContext.sessionVersion === medicalSession.version
    && reconnectContext.nextQuestion === null
    && reconnectContext.remainingQuestions?.length === 0;
  assert(reconnectedAtCompletedState, "Reconnect context did not resume from completed server state.");

  const deterministic = verifySession(medicalSession);
  const deterministicBlockers = deterministic.issues.filter((issue) =>
    issue.severity === "blocker" && !issue.resolved
  ).length;
  assert(deterministicBlockers === 0, "The medical session retained deterministic blockers.");
  const finalVerification = buildFinalVerification(medicalSession, {
    modelAvailable: true,
    semanticRun: clearSemanticRun(medicalSession)
  });
  assert(finalVerification.readyForFinalExport, "The clear semantic result did not unlock final export.");
  const renderedMedical = await renderVerifiedDocument(medicalSession, medicalSource);
  assert(
    renderedMedical.kind === "filled_pdf"
      && renderedMedical.report.coveragePercent === 100
      && renderedMedical.report.sourcePreserved,
    `The medical render failed: ${JSON.stringify(renderedMedical.report)}`
  );
  assert(buildSessionMemoryContext(medicalVault, medicalSession).rememberableAnswers.length === 0,
    "The medical form exposed a sensitive answer as rememberable.");

  const permissionForm = await loadFixture("activity-permission");
  let permissionSession = createFormSession(permissionForm);
  let permissionVault = createEmptyMemoryVault();
  const permissionExecutor = new InterviewToolExecutor();
  const savedPermission = executeTool(permissionExecutor, permissionSession, permissionVault, {
    callId: `run-${run}-permission-save`,
    name: "save_answers",
    arguments: JSON.stringify({
      sessionVersion: permissionSession.version,
      answers: [
        voiceAnswer("child_name", "Mila Hart"),
        voiceAnswer("guardian_name", "Alex Hart"),
        voiceAnswer("guardian_phone", "+31 6 12345678"),
        voiceAnswer("guardian_email", "alex@example.test"),
        voiceAnswer("will_attend", true),
        voiceAnswer("transport_home", "Picked up"),
        voiceAnswer("photo_consent", false)
      ]
    })
  });
  toolCalls += 1;
  permissionSession = savedPermission.session;
  permissionVault = savedPermission.vault;
  assert(savedPermission.output.ok, "The permission-form answers could not be saved.");
  const skippedPermission = executeTool(permissionExecutor, permissionSession, permissionVault, {
    callId: `run-${run}-permission-skip`,
    name: "mark_unknown_or_skipped",
    arguments: JSON.stringify({
      sessionVersion: permissionSession.version,
      fieldId: "accessibility_needs",
      disposition: "skipped",
      userWording: "There are no support needs to add."
    })
  });
  toolCalls += 1;
  permissionSession = skippedPermission.session;
  permissionVault = skippedPermission.vault;

  for (const fieldId of ["guardian_name", "guardian_phone", "guardian_email"]) {
    const checked = executeTool(permissionExecutor, permissionSession, permissionVault, {
      callId: `run-${run}-memory-check-${fieldId}`,
      name: "request_memory_confirmation",
      arguments: JSON.stringify({ sessionVersion: permissionSession.version, fieldId })
    });
    toolCalls += 1;
    assert(checked.output.ok && checked.output.eligible === true && checked.output.stored === false,
      `Memory eligibility failed for ${fieldId}.`);
    const remembered = executeTool(permissionExecutor, permissionSession, permissionVault, {
      callId: `run-${run}-memory-store-${fieldId}`,
      name: "remember_answer",
      arguments: JSON.stringify({
        sessionVersion: permissionSession.version,
        fieldId,
        subject: "Parent or guardian",
        confirmationWording: "Yes, remember this contact detail."
      })
    });
    toolCalls += 1;
    assert(remembered.output.ok && remembered.output.stored === true,
      `Explicit memory storage failed for ${fieldId}.`);
    permissionVault = remembered.vault;
  }

  const approvedClaims = permissionVault.claims.filter((claim) => claim.consent === "approved").length;
  const sensitiveClaims = permissionVault.claims.filter((claim) => claim.sensitivity !== "standard").length;
  assert(approvedClaims === 3 && sensitiveClaims === 0,
    "The Memory Vault did not retain exactly the three approved safe contact facts.");

  const schoolForm = await loadFixture("school-intake");
  let schoolSession = createFormSession(schoolForm);
  const schoolExecutor = new InterviewToolExecutor();
  const suggestions = buildSessionMemoryContext(permissionVault, schoolSession).suggestions;
  assert(suggestions.length === 3, "The school form did not receive three explicit memory suggestions.");
  for (const suggestion of suggestions) {
    const applied = executeTool(schoolExecutor, schoolSession, permissionVault, {
      callId: `run-${run}-memory-apply-${suggestion.fieldId}`,
      name: "confirm_memory_claim",
      arguments: JSON.stringify({
        sessionVersion: schoolSession.version,
        fieldId: suggestion.fieldId,
        claimId: suggestion.claimId,
        confirmationWording: "Yes, use this approved detail on the school form."
      })
    });
    toolCalls += 1;
    assert(applied.output.ok && applied.output.applied === true,
      `Approved memory reuse failed for ${suggestion.fieldId}.`);
    schoolSession = applied.session;
  }
  const reusedClaims = Object.values(schoolSession.prefillAnswers)
    .filter((answer) => answer.status === "answered" && answer.source === "memory").length;
  assert(reusedClaims === 3, "The school form did not retain three traceable memory answers.");

  return {
    run,
    durationMs: Math.round(performance.now() - startedAt),
    interview: {
      toolCalls,
      replayDeduplicated: replayedMedical.cached,
      reconnectedAtCompletedState
    },
    medical: {
      deterministicBlockers,
      clearSemanticFixturePassed: finalVerification.readyForFinalExport,
      renderKind: renderedMedical.kind,
      renderCoveragePercent: renderedMedical.report.coveragePercent,
      sourcePreserved: renderedMedical.report.sourcePreserved
    },
    memory: { approvedClaims, sensitiveClaims, reusedClaims }
  };
}

function executeTool(
  executor: InterviewToolExecutor,
  session: FormSession,
  vault: MemoryVault,
  request: { callId: string; name: string; arguments: string }
): InterviewToolExecution {
  return executor.execute(request, session, vault);
}

function voiceAnswer(fieldId: string, value: string | boolean) {
  return {
    fieldId,
    value,
    rawAnswer: typeof value === "boolean" ? value ? "Yes" : "No" : value,
    confidence: 1
  };
}

function clearSemanticRun(session: FormSession): SemanticVerificationRun {
  return {
    sessionId: session.id,
    sessionVersion: session.version,
    status: "completed",
    issues: [],
    model: "gpt-5.6-sol",
    mode: "standard",
    responseId: null,
    checkedAt: new Date().toISOString(),
    inputTokens: null,
    outputTokens: null
  };
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
