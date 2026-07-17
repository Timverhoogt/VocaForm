import {
  formSessionSchema,
  verificationResultSchema,
  type AnswerRecord,
  type FormDefinition,
  type FormField,
  type FormSession,
  type VerificationAction,
  type VerificationIssue,
  type VerificationResult
} from "./schemas";
import {
  AnswerValidationError,
  formatNormalizedAnswer,
  parseTextAnswer,
  validateAnswerValue
} from "./answers";
import {
  isDocumentFormField,
  isWebFormDefinition,
  isWebFormField,
  listFormFields
} from "./form_definition";

export interface SessionSummary {
  totalFields: number;
  answeredFields: number;
  handledFields: number;
  openFields: number;
  requiredOpen: number;
  completionPercent: number;
}

export interface VerificationOptions {
  approvedMemoryClaimIds?: ReadonlySet<string>;
}

export function listFields(form: FormDefinition): FormField[] {
  return listFormFields(form);
}

export function findField(form: FormDefinition, fieldId: string): FormField | null {
  return listFields(form).find((field) => field.id === fieldId) ?? null;
}

export function createFormSession(form: FormDefinition, now = new Date()): FormSession {
  const timestamp = now.toISOString();
  const answers = Object.fromEntries(
    listFields(form).map((field) => [field.id, createEmptyAnswer(field.id, timestamp)])
  );
  const prefillAnswers = Object.fromEntries(
    form.prefillFields
      .filter((field) => !(field.id in answers))
      .map((field) => [field.id, createEmptyAnswer(field.id, timestamp)])
  );

  return formSessionSchema.parse({
    id: crypto.randomUUID(),
    version: 0,
    form,
    answers,
    prefillAnswers,
    verificationResolutions: {},
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function saveTextAnswer(
  session: FormSession,
  fieldId: string,
  value: string | string[],
  now = new Date()
): FormSession {
  const field = findField(session.form, fieldId);
  if (!field) throw new Error(`Unknown field: ${fieldId}`);
  if (!isFieldApplicable(session, field)) {
    throw new Error(`${field.label} is not currently applicable to this form path.`);
  }

  const canonicalValue = Array.isArray(value) ? value : parseTextAnswer(field, value);
  if (Array.isArray(value)) validateAnswerValue(field, canonicalValue);
  const rawAnswer = Array.isArray(value) ? value.join(", ") : value;

  return replaceAnswer(session, {
    fieldId,
    status: "answered",
    value: canonicalValue,
    rawAnswer,
    normalizedAnswer: formatNormalizedAnswer(canonicalValue),
    confidence: 1,
    followUpQuestion: null,
    source: "text",
    memoryClaimId: null,
    updatedAt: now.toISOString()
  });
}

export function correctSessionAnswer(
  session: FormSession,
  fieldId: string,
  value: string,
  now = new Date()
): FormSession {
  const field = findField(session.form, fieldId);
  const prefill = session.form.prefillFields.find((candidate) => candidate.id === fieldId);
  if (!field && !prefill) throw new Error(`Unknown field: ${fieldId}`);
  const canonicalValue = field ? parseTextAnswer(field, value) : value.trim();
  if (typeof canonicalValue === "string" && !canonicalValue) throw new Error("An answer cannot be empty.");
  const timestamp = now.toISOString();
  const answer: AnswerRecord = {
    fieldId,
    status: "answered",
    value: canonicalValue,
    rawAnswer: value,
    normalizedAnswer: formatNormalizedAnswer(canonicalValue),
    confidence: 1,
    followUpQuestion: null,
    source: "user_correction",
    memoryClaimId: null,
    updatedAt: timestamp
  };
  return replaceAnswer(session, answer, field ? "answers" : "prefillAnswers");
}

export function leaveSessionAnswerBlank(
  session: FormSession,
  fieldId: string,
  now = new Date()
): FormSession {
  const field = findField(session.form, fieldId);
  const prefill = session.form.prefillFields.find((candidate) => candidate.id === fieldId);
  if (!field && !prefill) throw new Error(`Unknown field: ${fieldId}`);
  if (field?.required) throw new Error(`${field.label} is required and cannot be left blank.`);
  const timestamp = now.toISOString();
  const answer: AnswerRecord = {
    fieldId,
    status: "skipped",
    value: null,
    rawAnswer: "Intentionally left blank during verification.",
    normalizedAnswer: null,
    confidence: 1,
    followUpQuestion: null,
    source: "user_correction",
    memoryClaimId: null,
    updatedAt: timestamp
  };
  return replaceAnswer(session, answer, field ? "answers" : "prefillAnswers");
}

export function skipAnswer(session: FormSession, fieldId: string, now = new Date()): FormSession {
  const field = findField(session.form, fieldId);
  if (!field) throw new Error(`Unknown field: ${fieldId}`);

  return replaceAnswer(session, {
    fieldId,
    status: "skipped",
    value: null,
    rawAnswer: null,
    normalizedAnswer: null,
    confidence: 1,
    followUpQuestion: null,
    source: "text",
    memoryClaimId: null,
    updatedAt: now.toISOString()
  });
}

export function summarizeSession(session: FormSession): SessionSummary {
  const fields = listFields(session.form);
  const answeredFields = fields.filter((field) => session.answers[field.id]?.status === "answered").length;
  const handledFields = fields.filter((field) => isFieldHandled(session, field)).length;
  const openFields = fields.filter(
    (field) => isFieldInterviewable(field)
      && isFieldApplicable(session, field)
      && isOpen(session.answers[field.id])
  ).length;
  const requiredOpen = fields.filter(
    (field) => isFieldInterviewable(field)
      && isFieldApplicable(session, field)
      && field.required
      && session.answers[field.id]?.status !== "answered"
  ).length;

  return {
    totalFields: fields.length,
    answeredFields,
    handledFields,
    openFields,
    requiredOpen,
    completionPercent: fields.length === 0 ? 0 : Math.round((handledFields / fields.length) * 100)
  };
}

export function nextOpenField(session: FormSession): FormField | null {
  return listFields(session.form).find(
    (field) => isFieldInterviewable(field)
      && isFieldApplicable(session, field)
      && isOpen(session.answers[field.id])
  ) ?? null;
}

export function verifySession(
  session: FormSession,
  now = new Date(),
  options: VerificationOptions = {}
): VerificationResult {
  const issues: VerificationIssue[] = [];

  for (const field of listFields(session.form)) {
    const answer = session.answers[field.id];
    if (isDocumentFormField(field) && field.renderTargets.length === 0) {
      const fallbackReady = field.renderFallback === "append_answer_packet";
      issues.push(makeIssue(
        field.id,
        fallbackReady ? "warning" : "blocker",
        "render_target_missing",
        fallbackReady
          ? `“${field.label}” will use the fallback answer packet.`
          : `Confirm how “${field.label}” should be handled before final export.`,
        "No renderer target is available for this field.",
        ["confirm"]
      ));
    }
    if (isWebFormField(field)
      && isFieldApplicable(session, field)
      && field.support.status === "unsupported") {
      issues.push(makeIssue(
        field.id,
        "blocker",
        "unsupported_control",
        `“${field.label}” uses a web control VocaForm cannot safely deliver yet.`,
        field.support.reason,
        []
      ));
    } else if (isWebFormField(field)
      && isFieldApplicable(session, field)
      && field.deliveryTargets.length === 0) {
      issues.push(makeIssue(
        field.id,
        "blocker",
        "delivery_target_missing",
        `VocaForm has no safe native control target for “${field.label}”.`,
        "No provider-independent delivery target is available for this web-form field.",
        []
      ));
    }
    if (!isFieldInterviewable(field)
      && (!answer || answer.status === "unanswered" || answer.status === "skipped")) continue;

    if (!isFieldApplicable(session, field)) {
      if (answer?.status === "answered" || answer?.status === "needs_followup") {
        issues.push(makeIssue(
          field.id,
          "blocker",
          "contradiction",
          `“${field.label}” has an answer even though its form condition is not met.`,
          `Its answer is ${answer.normalizedAnswer || "present"}; the controlling answer makes this field inapplicable.`,
          field.required ? ["correct"] : ["correct", "leave_blank"],
          field.dependencies.map((dependency) => dependency.fieldId)
        ));
      }
      continue;
    }

    if (!answer || answer.status === "unanswered") {
      if (field.required) issues.push(makeIssue(
        field.id,
        "blocker",
        "required_missing",
        "This required answer is still missing.",
        `“${field.label}” is marked required on the source form.`,
        ["answer"]
      ));
      continue;
    }

    if (answer.status === "skipped" && field.required) {
      issues.push(makeIssue(
        field.id,
        "blocker",
        "required_skipped",
        "This required question was skipped.",
        `“${field.label}” is marked required on the source form.`,
        ["answer"]
      ));
    }
    if (answer.status === "needs_followup") {
      issues.push(makeIssue(
        field.id,
        "blocker",
        "needs_followup",
        "This answer still needs clarification.",
        answer.followUpQuestion || answer.rawAnswer || `“${field.label}” was marked for follow-up.`,
        field.required ? ["confirm", "correct"] : ["confirm", "correct", "leave_blank"]
      ));
    }
    if (answer.status === "answered") {
      if (answer.value === null) {
        issues.push(makeIssue(
          field.id,
          "blocker",
          "invalid_value",
          "This saved answer has no usable value.",
          answer.rawAnswer || `“${field.label}” has an empty canonical value.`,
          ["correct"]
        ));
      } else {
        try {
          validateAnswerValue(field, answer.value);
        } catch (error) {
          issues.push(makeIssue(
            field.id,
            "blocker",
            "invalid_value",
            error instanceof AnswerValidationError ? error.message : `“${field.label}” has an invalid value.`,
            `Saved as ${answer.normalizedAnswer || formatNormalizedAnswer(answer.value)}.`,
            ["correct"]
          ));
        }
      }
      if (!hasAnswerProvenance(answer, options.approvedMemoryClaimIds)) {
        issues.push(makeIssue(
          field.id,
          "blocker",
          "unsupported_claim",
          `Confirm or correct “${field.label}”; its answer is not linked to conversation, memory, or a correction.`,
          `Saved with source “${answer.source}” and no accepted provenance.`,
          field.required ? ["confirm", "correct"] : ["confirm", "correct", "leave_blank"]
        ));
      }
      if (answer.confidence < 0.7) {
        issues.push(makeIssue(
          field.id,
          "warning",
          "low_confidence",
          "Review this answer before final export.",
          `The recorded confidence is ${Math.round(answer.confidence * 100)}%.`,
          field.required ? ["confirm", "correct"] : ["confirm", "correct", "leave_blank"]
        ));
      }
    }
  }

  if (isWebFormDefinition(session.form)) {
    const webForm = session.form;
    if (webForm.flow.coverage === "current_page_only") {
      issues.push(makeIssue(
        null,
        "blocker",
        "unsupported_flow",
        "The provider has later pages that were not inspected.",
        "VocaForm prepared the visible questions and will use a guided manual hand-off for any remaining pages.",
        []
      ));
    }
    const ordinals = new Map(webForm.flow.pages.map((page) => [page.id, page.ordinal]));
    const unsupportedEdges = webForm.flow.edges.filter((edge) => {
      if (edge.kind === "unknown") return webForm.flow.coverage === "complete";
      if (edge.toPageId === null) return false;
      return (ordinals.get(edge.toPageId) ?? 0) <= (ordinals.get(edge.fromPageId) ?? 0);
    });
    if (unsupportedEdges.length > 0) {
      issues.push(makeIssue(
        null,
        "blocker",
        "unsupported_flow",
        "This form uses branching VocaForm cannot safely interview yet.",
        "Only deterministic forward-only page branches are supported in the public web-form MVP.",
        []
      ));
    }
  }

  for (const answer of Object.values(session.prefillAnswers)) {
    if (answer.status !== "answered") continue;
    if (!hasAnswerProvenance(answer, options.approvedMemoryClaimIds)) {
      issues.push(makeIssue(
        answer.fieldId,
        "blocker",
        "unsupported_claim",
        "Confirm, correct, or remove this profile detail before final export.",
        `The profile value is saved with source “${answer.source}” and no approved memory claim.`,
        ["confirm", "correct", "leave_blank"]
      ));
    }
  }

  const resolvedIssues = issues.map((issue) => ({
    ...issue,
    resolved: isVerificationIssueResolved(session, issue)
  }));

  return verificationResultSchema.parse({
    readyForFinalExport: !resolvedIssues.some((issue) => issue.severity === "blocker" && !issue.resolved),
    issues: resolvedIssues,
    deterministicIssueCount: resolvedIssues.length,
    semanticStatus: "not_run",
    semanticModel: null,
    semanticMode: null,
    verifiedSessionVersion: null,
    checkedAt: now.toISOString()
  });
}

export function isFieldApplicable(session: FormSession, field: FormField): boolean {
  if (isWebFormDefinition(session.form) && isWebFormField(field)) {
    if (webFormPageDisposition(session, field.pageId) !== "reachable") return false;
  }
  return field.dependencies.every((dependency) => dependencyResult(session, dependency) === true);
}

export function isFieldInterviewable(field: FormField): boolean {
  return !isWebFormField(field)
    || !["file_upload", "unsupported", "matrix", "ranking"].includes(field.type);
}

function createEmptyAnswer(fieldId: string, updatedAt: string): AnswerRecord {
  return {
    fieldId,
    status: "unanswered",
    value: null,
    rawAnswer: null,
    normalizedAnswer: null,
    confidence: 0,
    followUpQuestion: null,
    source: "import",
    memoryClaimId: null,
    updatedAt
  };
}

function replaceAnswer(
  session: FormSession,
  answer: AnswerRecord,
  target: "answers" | "prefillAnswers" = "answers"
): FormSession {
  return formSessionSchema.parse({
    ...session,
    version: session.version + 1,
    updatedAt: answer.updatedAt,
    answers: target === "answers" ? {
      ...session.answers,
      [answer.fieldId]: answer
    } : session.answers,
    prefillAnswers: target === "prefillAnswers" ? {
      ...session.prefillAnswers,
      [answer.fieldId]: answer
    } : session.prefillAnswers
  });
}

function isOpen(answer: AnswerRecord | undefined): boolean {
  return !answer || answer.status === "unanswered" || answer.status === "needs_followup";
}

function isFieldHandled(session: FormSession, field: FormField): boolean {
  const answer = session.answers[field.id];
  if (answer?.status === "answered" || answer?.status === "skipped") return true;
  if (!isFieldInterviewable(field)) return true;
  if (isWebFormDefinition(session.form) && isWebFormField(field)) {
    const disposition = webFormPageDisposition(session, field.pageId);
    if (disposition === "excluded") return true;
    if (disposition === "pending") return false;
  }
  if (field.dependencies.length === 0) return false;
  const dependenciesDecided = field.dependencies.every((dependency) => {
    const dependencyAnswer = session.answers[dependency.fieldId];
    return dependencyAnswer?.status === "answered" || dependencyAnswer?.status === "skipped";
  });
  return dependenciesDecided && !isFieldApplicable(session, field);
}

function webFormPageDisposition(
  session: FormSession,
  pageId: string
): "reachable" | "pending" | "excluded" {
  if (!isWebFormDefinition(session.form)) return "reachable";
  const reachable = traverseWebFormPages(session, false);
  if (reachable.has(pageId)) return "reachable";
  const possible = traverseWebFormPages(session, true);
  return possible.has(pageId) ? "pending" : "excluded";
}

function traverseWebFormPages(session: FormSession, includeUnresolved: boolean): Set<string> {
  if (!isWebFormDefinition(session.form)) return new Set();
  const reached = new Set<string>();
  const queue = [session.form.flow.entryPageId];

  while (queue.length > 0) {
    const pageId = queue.shift() as string;
    if (reached.has(pageId)) continue;
    reached.add(pageId);
    const outgoing = session.form.flow.edges.filter((edge) => edge.fromPageId === pageId);
    const conditional = outgoing.filter((edge) => edge.kind === "conditional");
    const next = outgoing.filter((edge) => edge.kind === "next");
    const matches = conditional.filter((edge) => dependencyResult(session, edge.condition) === true);
    const unresolved = conditional.filter((edge) => dependencyResult(session, edge.condition) === null);
    let targets: string[];

    if (matches.length > 0) {
      targets = matches.map((edge) => edge.toPageId);
    } else if (unresolved.length > 0) {
      const possibleTargets = [...new Set([
        ...conditional.map((edge) => edge.toPageId),
        ...next.map((edge) => edge.toPageId)
      ])];
      targets = includeUnresolved || possibleTargets.length === 1 ? possibleTargets : [];
    } else {
      targets = next.map((edge) => edge.toPageId);
    }
    for (const target of targets) {
      if (!reached.has(target)) queue.push(target);
    }
  }
  return reached;
}

function dependencyResult(
  session: FormSession,
  dependency: FormField["dependencies"][number]
): boolean | null {
  const answer = session.answers[dependency.fieldId];
  if (!answer || answer.status === "unanswered" || answer.status === "needs_followup") return null;
  if (answer.status !== "answered" || answer.value === null) return false;
  const actual = answer.value;
  if (dependency.operator === "is_present") return true;
  if (typeof actual === "object" && !Array.isArray(actual)) return false;
  const expected = dependency.value ?? "";
  if (dependency.operator === "includes") {
    return Array.isArray(actual)
      ? actual.some((value) => equal(value, expected))
      : normalizeComparable(actual).includes(normalizeComparable(expected));
  }
  const matches = Array.isArray(actual)
    ? actual.some((value) => equal(value, expected))
    : equal(actual, expected);
  return dependency.operator === "not_equals" ? !matches : matches;
}

function equal(actual: string | number | boolean, expected: string): boolean {
  return normalizeComparable(actual) === normalizeComparable(expected);
}

function normalizeComparable(value: string | number | boolean): string {
  const normalized = String(value).trim().toLocaleLowerCase();
  if (["true", "yes", "y", "ja"].includes(normalized)) return "yes";
  if (["false", "no", "n", "nee"].includes(normalized)) return "no";
  return normalized;
}

export function isVerificationIssueResolved(session: FormSession, issue: VerificationIssue): boolean {
  if (issue.kind === "unsupported_control"
    || issue.kind === "delivery_target_missing"
    || issue.kind === "unsupported_flow") return false;
  const resolution = session.verificationResolutions[issue.id];
  if (!resolution || !issue.actions.includes(resolution.action)) return false;
  const fieldIds = [issue.fieldId, ...issue.relatedFieldIds].filter((fieldId): fieldId is string => Boolean(fieldId));
  return fieldIds.every((fieldId) => resolution.answerFingerprints[fieldId] === answerFingerprint(session, fieldId));
}

export function answerFingerprint(session: FormSession, fieldId: string): string {
  const answer = session.answers[fieldId] ?? session.prefillAnswers[fieldId];
  return answer ? JSON.stringify({
    status: answer.status,
    value: answer.value,
    rawAnswer: answer.rawAnswer,
    normalizedAnswer: answer.normalizedAnswer,
    confidence: answer.confidence,
    followUpQuestion: answer.followUpQuestion,
    source: answer.source,
    memoryClaimId: answer.memoryClaimId,
    updatedAt: answer.updatedAt
  }) : "missing";
}

function hasAnswerProvenance(answer: AnswerRecord, approvedMemoryClaimIds?: ReadonlySet<string>): boolean {
  if (answer.source === "memory") {
    return Boolean(answer.memoryClaimId)
      && (!approvedMemoryClaimIds || approvedMemoryClaimIds.has(answer.memoryClaimId as string));
  }
  if (answer.source === "voice" || answer.source === "text" || answer.source === "user_correction") {
    return Boolean(answer.rawAnswer?.trim());
  }
  return false;
}

function makeIssue(
  fieldId: string | null,
  severity: VerificationIssue["severity"],
  kind: VerificationIssue["kind"],
  message: string,
  evidence: string,
  actions: VerificationAction[],
  relatedFieldIds: string[] = []
): VerificationIssue {
  return {
    id: `${fieldId ?? "form"}:${kind}`,
    fieldId,
    relatedFieldIds,
    severity,
    kind,
    message,
    evidence,
    actions,
    source: "deterministic",
    resolved: false
  };
}
