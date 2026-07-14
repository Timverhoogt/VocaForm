import {
  formSessionSchema,
  verificationResultSchema,
  type FormSession,
  type SemanticVerificationOutput,
  type VerificationAction,
  type VerificationIssue,
  type VerificationResult
} from "./schemas";
import {
  answerFingerprint,
  correctSessionAnswer,
  findField,
  isVerificationIssueResolved,
  leaveSessionAnswerBlank,
  verifySession
} from "./session";

export interface SemanticVerificationRun {
  sessionId: string;
  sessionVersion: number;
  status: "completed" | "error";
  issues: VerificationIssue[];
  model: string;
  mode: "standard" | "pro";
  responseId: string | null;
  checkedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface FinalVerificationOptions {
  approvedMemoryClaimIds?: ReadonlySet<string>;
  modelAvailable: boolean;
  semanticRun: SemanticVerificationRun | null;
}

export interface ResolutionInput {
  action: VerificationAction;
  fieldId?: string | null;
  value?: string | null;
}

export interface ResolutionResult {
  session: FormSession;
  answerChanged: boolean;
}

export class VerificationValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function buildFinalVerification(
  session: FormSession,
  options: FinalVerificationOptions,
  now = new Date()
): VerificationResult {
  const deterministic = verifySession(session, now, {
    approvedMemoryClaimIds: options.approvedMemoryClaimIds
  });
  const run = options.semanticRun?.sessionId === session.id
    && options.semanticRun.sessionVersion === session.version
    ? options.semanticRun
    : null;
  const semanticIssues = run?.status === "completed"
    ? run.issues.map((issue) => ({ ...issue, resolved: isVerificationIssueResolved(session, issue) }))
    : [];
  const issues = [...deterministic.issues, ...semanticIssues];
  const unresolvedBlockers = issues.filter((issue) => issue.severity === "blocker" && !issue.resolved);
  const semanticStatus = run?.status === "error"
    ? "error"
    : run?.status === "completed"
      ? semanticIssues.length > 0 ? "findings" : "passed"
      : options.modelAvailable ? "not_run" : "unavailable";
  const semanticComplete = run?.status === "completed";

  return verificationResultSchema.parse({
    readyForFinalExport: semanticComplete && unresolvedBlockers.length === 0,
    issues,
    deterministicIssueCount: deterministic.issues.length,
    semanticStatus,
    semanticModel: run?.model ?? null,
    semanticMode: run?.mode ?? null,
    verifiedSessionVersion: semanticComplete ? session.version : null,
    checkedAt: run?.checkedAt ?? deterministic.checkedAt
  });
}

export function createSemanticIssues(
  session: FormSession,
  output: SemanticVerificationOutput
): VerificationIssue[] {
  const knownIds = new Set([
    ...session.form.sections.flatMap((section) => section.fields.map((field) => field.id)),
    ...session.form.prefillFields.map((field) => field.id)
  ]);
  const issues = new Map<string, VerificationIssue>();

  for (const finding of output.findings) {
    const fieldIds = [...new Set(finding.fieldIds)];
    const unknownId = fieldIds.find((fieldId) => !knownIds.has(fieldId));
    if (unknownId) {
      throw new VerificationValidationError(
        "unknown_model_field",
        `The verifier referenced an unknown field: ${unknownId}.`
      );
    }
    const primaryFieldId = fieldIds[0] as string;
    const primaryField = findField(session.form, primaryFieldId);
    const actions = normalizeActions(finding.actions, Boolean(primaryField?.required));
    const id = `model:${finding.kind}:${fieldIds.slice().sort().join("+")}`;
    if (issues.has(id)) continue;
    const issue: VerificationIssue = {
      id,
      fieldId: primaryFieldId,
      relatedFieldIds: fieldIds.slice(1),
      severity: finding.severity,
      kind: finding.kind,
      message: finding.message,
      evidence: finding.evidence,
      actions,
      source: "model",
      resolved: false
    };
    issues.set(id, { ...issue, resolved: isVerificationIssueResolved(session, issue) });
  }

  return [...issues.values()];
}

export function resolveVerificationIssue(
  session: FormSession,
  issue: VerificationIssue,
  input: ResolutionInput,
  now = new Date()
): ResolutionResult {
  if (issue.resolved) {
    throw new VerificationValidationError("already_resolved", "That finding is already resolved.");
  }
  if (!issue.actions.includes(input.action)) {
    throw new VerificationValidationError("action_not_allowed", "Choose one of the actions offered for this finding.");
  }
  const issueFieldIds = [issue.fieldId, ...issue.relatedFieldIds]
    .filter((fieldId): fieldId is string => Boolean(fieldId));
  const fieldId = input.fieldId ?? issue.fieldId;
  if (fieldId && !issueFieldIds.includes(fieldId)) {
    throw new VerificationValidationError("field_not_allowed", "That field is not part of this finding.");
  }

  if (input.action === "answer" || input.action === "correct") {
    if (!fieldId) throw new VerificationValidationError("field_missing", "Choose the answer to update.");
    if (!input.value?.trim()) throw new VerificationValidationError("value_missing", "Enter the answer you want to save.");
    return {
      session: correctSessionAnswer(session, fieldId, input.value, now),
      answerChanged: true
    };
  }

  if (input.action === "leave_blank") {
    if (!fieldId) throw new VerificationValidationError("field_missing", "Choose the answer to leave blank.");
    return {
      session: leaveSessionAnswerBlank(session, fieldId, now),
      answerChanged: true
    };
  }

  const timestamp = now.toISOString();
  const answerFingerprints = Object.fromEntries(
    issueFieldIds.map((candidate) => [candidate, answerFingerprint(session, candidate)])
  );
  return {
    session: formSessionSchema.parse({
      ...session,
      version: session.version + 1,
      updatedAt: timestamp,
      verificationResolutions: {
        ...session.verificationResolutions,
        [issue.id]: {
          issueId: issue.id,
          action: input.action,
          answerFingerprints,
          resolvedAt: timestamp
        }
      }
    }),
    answerChanged: false
  };
}

function normalizeActions(actions: VerificationAction[], required: boolean): VerificationAction[] {
  const allowed = actions.filter((action) => !(required && action === "leave_blank"));
  const unique = [...new Set(allowed)];
  return unique.length > 0 ? unique : ["confirm", "correct"];
}
