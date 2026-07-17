import { describe, expect, it } from "vitest";
import {
  formSessionSchema,
  type SemanticVerificationOutput
} from "./schemas";
import {
  correctSessionAnswer,
  createFormSession,
  isVerificationIssueResolved,
  saveTextAnswer,
  skipAnswer,
  summarizeSession,
  verifySession
} from "./session";
import {
  buildFinalVerification,
  createSemanticIssues,
  resolveVerificationIssue,
  VerificationValidationError
} from "./verification";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import { loadDeterministicVerificationFixtures } from "../evals/verification_fixtures";
import { listFormFields } from "./form_definition";

const NOW = new Date("2026-07-14T12:00:00.000Z");

describe("final verification domain", () => {
  it("catches every seeded deterministic missing, dependency, type, provenance, and renderer failure", async () => {
    for (const fixture of await loadDeterministicVerificationFixtures()) {
      const result = verifySession(fixture.session, NOW);
      expect(result.issues, fixture.id).toContainEqual(expect.objectContaining({
        fieldId: fixture.expected.fieldId,
        kind: fixture.expected.kind,
        source: "deterministic",
        resolved: false
      }));
      expect(result.readyForFinalExport, fixture.id).toBe(false);
    }
  });

  it("canonicalizes typed answers before deterministic validation", async () => {
    const form = (await loadGoldenCompilerFixtures())
      .find((fixture) => fixture.id === "activity-permission-conditional")!.form;
    let session = createFormSession(form, NOW);
    session = saveTextAnswer(session, "will_attend", "yes", new Date("2026-07-14T12:01:00.000Z"));

    expect(session.answers.will_attend).toMatchObject({
      value: true,
      normalizedAnswer: "Yes",
      rawAnswer: "yes",
      source: "text"
    });
    expect(verifySession(session).issues).not.toContainEqual(expect.objectContaining({
      fieldId: "will_attend",
      kind: "invalid_value"
    }));
  });

  it("preserves typed multi-choice selections as a validated list", async () => {
    const base = (await loadGoldenCompilerFixtures())
      .find((fixture) => fixture.id === "activity-permission-conditional")!.form;
    const form = structuredClone(base);
    const transport = listFormFields(form).find((field) => field.id === "transport_home")!;
    transport.type = "multi_choice";
    let session = createFormSession(form, NOW);
    session = saveTextAnswer(session, "will_attend", "Yes");
    session = saveTextAnswer(session, "transport_home", ["Picked up", "School bus"]);

    expect(session.answers.transport_home).toMatchObject({
      value: ["Picked up", "School bus"],
      normalizedAnswer: "Picked up, School bus",
      rawAnswer: "Picked up, School bus",
      source: "text"
    });
    expect(() => saveTextAnswer(session, "transport_home", ["Hovercraft"]))
      .toThrow("contains a choice not shown on the form");
  });

  it("counts skipped and resolved conditional questions as completed progress", async () => {
    let session = await completeRequiredActivityAnswers();
    session = skipAnswer(session, "guardian_email");
    session = skipAnswer(session, "accessibility_needs");

    expect(summarizeSession(session)).toMatchObject({
      totalFields: 8,
      answeredFields: 5,
      handledFields: 8,
      openFields: 0,
      requiredOpen: 0,
      completionPercent: 100
    });
  });

  it("requires a current completed semantic pass before final export", async () => {
    const session = await completeRequiredActivityAnswers();
    const deterministic = verifySession(session, NOW);
    expect(deterministic.issues.filter((issue) => issue.severity === "blocker")).toHaveLength(0);

    expect(buildFinalVerification(session, {
      modelAvailable: true,
      semanticRun: null
    }).readyForFinalExport).toBe(false);
    expect(buildFinalVerification(session, {
      modelAvailable: true,
      semanticRun: completedRun(session)
    })).toMatchObject({
      readyForFinalExport: true,
      semanticStatus: "passed",
      verifiedSessionVersion: session.version
    });
    expect(buildFinalVerification(session, {
      modelAvailable: true,
      semanticRun: { ...completedRun(session), sessionVersion: session.version - 1 }
    }).readyForFinalExport).toBe(false);
  });

  it("never changes an answer when the user confirms a semantic finding", async () => {
    const session = await completeRequiredActivityAnswers();
    const output: SemanticVerificationOutput = {
      findings: [{
        kind: "ambiguous_answer",
        severity: "blocker",
        fieldIds: ["child_name"],
        message: "Confirm which full name should be used.",
        evidence: "The name may be abbreviated.",
        actions: ["confirm", "correct"]
      }]
    };
    const issue = createSemanticIssues(session, output)[0]!;
    expect(buildFinalVerification(session, {
      modelAvailable: true,
      semanticRun: { ...completedRun(session), issues: [issue] }
    }).readyForFinalExport).toBe(false);
    const beforeAnswers = JSON.stringify(session.answers);
    const resolution = resolveVerificationIssue(session, issue, { action: "confirm" }, NOW);

    expect(JSON.stringify(resolution.session.answers)).toBe(beforeAnswers);
    expect(resolution.answerChanged).toBe(false);
    expect(isVerificationIssueResolved(resolution.session, issue)).toBe(true);
    expect(buildFinalVerification(resolution.session, {
      modelAvailable: true,
      semanticRun: {
        ...completedRun(resolution.session),
        issues: [issue]
      }
    }).readyForFinalExport).toBe(true);
    const laterCorrection = correctSessionAnswer(
      resolution.session,
      "child_name",
      "Mila Johanna Hart",
      new Date("2026-07-14T12:05:00.000Z")
    );
    expect(isVerificationIssueResolved(laterCorrection, issue)).toBe(false);
    expect(buildFinalVerification(laterCorrection, {
      modelAvailable: true,
      semanticRun: {
        ...completedRun(resolution.session),
        issues: [issue]
      }
    }).readyForFinalExport).toBe(false);
  });

  it("records corrections and intentional blanks with explicit user provenance", async () => {
    const missingFixture = (await loadDeterministicVerificationFixtures())
      .find((fixture) => fixture.id === "missing-required-answer")!;
    const requiredIssue = verifySession(missingFixture.session).issues
      .find((issue) => issue.fieldId === "child_name" && issue.kind === "required_missing")!;
    const answered = resolveVerificationIssue(missingFixture.session, requiredIssue, {
      action: "answer",
      value: "Mila Hart"
    }, NOW).session;
    expect(answered.answers.child_name).toMatchObject({
      status: "answered",
      source: "user_correction",
      rawAnswer: "Mila Hart"
    });

    const modelIssue = createSemanticIssues(answered, {
      findings: [{
        kind: "ambiguous_answer",
        severity: "warning",
        fieldIds: ["accessibility_needs"],
        message: "Say whether support needs should be listed.",
        evidence: "The answer is not specific.",
        actions: ["correct", "leave_blank"]
      }]
    })[0]!;
    const blank = resolveVerificationIssue(answered, modelIssue, {
      action: "leave_blank"
    }, NOW).session;
    expect(blank.answers.accessibility_needs).toMatchObject({
      status: "skipped",
      source: "user_correction",
      rawAnswer: "Intentionally left blank during verification."
    });
  });

  it("rejects model findings that cite fields outside the compiled form", async () => {
    const session = await completeRequiredActivityAnswers();
    expect(() => createSemanticIssues(session, {
      findings: [{
        kind: "unsupported_claim",
        severity: "blocker",
        fieldIds: ["invented_field"],
        message: "Invented.",
        evidence: "Invented.",
        actions: ["correct"]
      }]
    })).toThrowError(VerificationValidationError);
    expect(formSessionSchema.parse(session)).toEqual(session);
  });
});

async function completeRequiredActivityAnswers() {
  const form = (await loadGoldenCompilerFixtures())
    .find((fixture) => fixture.id === "activity-permission-conditional")!.form;
  let session = createFormSession(form, NOW);
  for (const [fieldId, value] of [
    ["child_name", "Mila Hart"],
    ["guardian_name", "Alex Hart"],
    ["guardian_phone", "+31 6 12345678"],
    ["will_attend", "No"],
    ["photo_consent", "No"]
  ] as const) {
    session = saveTextAnswer(session, fieldId, value);
  }
  return session;
}

function completedRun(session: Awaited<ReturnType<typeof completeRequiredActivityAnswers>>) {
  return {
    sessionId: session.id,
    sessionVersion: session.version,
    status: "completed" as const,
    issues: [],
    model: "gpt-5.6-sol",
    mode: "standard" as const,
    responseId: "resp_test",
    checkedAt: "2026-07-14T13:00:00.000Z",
    inputTokens: 100,
    outputTokens: 20
  };
}
