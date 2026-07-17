import {
  formSessionSchema,
  type AnswerRecord,
  type AnswerValue,
  type FormField,
  type FormSession
} from "./schemas";
import {
  AnswerValidationError as InterviewValidationError,
  formatNormalizedAnswer,
  validateAnswerValue
} from "./answers";
import type { SessionMemoryContext } from "./memory";
import {
  isFieldApplicable,
  isFieldInterviewable,
  listFields,
  summarizeSession,
  verifySession
} from "./session";

export { AnswerValidationError as InterviewValidationError } from "./answers";

export interface VoiceAnswerInput {
  fieldId: string;
  value: AnswerValue;
  rawAnswer: string;
  confidence: number;
}

export interface InterviewQuestion {
  fieldId: string;
  sectionTitle: string;
  label: string;
  prompt: string;
  type: FormField["type"];
  required: boolean;
  options: string[];
  examples: string[];
}

export interface InterviewContext {
  sessionId: string;
  sessionVersion: number;
  formTitle: string;
  locale: string;
  completionPercent: number;
  requiredOpen: number;
  answeredFieldIds: string[];
  skippedFieldIds: string[];
  nextQuestion: InterviewQuestion | null;
  remainingQuestions: InterviewQuestion[];
  memory: SessionMemoryContext;
}

export function saveVoiceAnswers(
  session: FormSession,
  inputs: VoiceAnswerInput[],
  now = new Date()
): FormSession {
  if (inputs.length === 0) {
    throw new InterviewValidationError("empty_answer_batch", "Save at least one answer.");
  }
  const duplicateId = inputs.find(
    (input, index) => inputs.findIndex((candidate) => candidate.fieldId === input.fieldId) !== index
  )?.fieldId;
  if (duplicateId) {
    throw new InterviewValidationError("duplicate_field", `The answer batch repeats ${duplicateId}.`);
  }

  const timestamp = now.toISOString();
  const records = new Map<string, AnswerRecord>();
  for (const input of inputs) {
    const field = requireField(session, input.fieldId);
    validateAnswerValue(field, input.value);
    const rawAnswer = input.rawAnswer.trim();
    if (!rawAnswer) {
      throw new InterviewValidationError("missing_provenance", `The spoken wording for ${field.label} is missing.`);
    }
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new InterviewValidationError("invalid_confidence", `Confidence for ${field.label} must be between 0 and 1.`);
    }
    records.set(field.id, {
      fieldId: field.id,
      status: input.confidence < 0.7 ? "needs_followup" : "answered",
      value: input.value,
      rawAnswer,
      normalizedAnswer: formatNormalizedAnswer(input.value),
      confidence: input.confidence,
      followUpQuestion: input.confidence < 0.7 ? `Please confirm ${field.label}.` : null,
      source: "voice",
      memoryClaimId: null,
      updatedAt: timestamp
    });
  }

  const candidate = formSessionSchema.parse({
    ...session,
    answers: { ...session.answers, ...Object.fromEntries(records) }
  });
  for (const input of inputs) {
    const field = requireField(candidate, input.fieldId);
    if (!isFieldApplicable(candidate, field)) {
      throw new InterviewValidationError(
        "inapplicable_field",
        `${field.label} is not applicable given the current conditional answers.`
      );
    }
  }

  return formSessionSchema.parse({
    ...candidate,
    version: session.version + 1,
    updatedAt: timestamp
  });
}

export function markVoiceUnresolved(
  session: FormSession,
  fieldId: string,
  disposition: "unknown" | "skipped",
  userWording: string,
  now = new Date()
): FormSession {
  const field = requireField(session, fieldId);
  if (!isFieldApplicable(session, field)) {
    throw new InterviewValidationError("inapplicable_field", `${field.label} is not currently applicable.`);
  }
  const timestamp = now.toISOString();
  const wording = userWording.trim();
  if (!wording) {
    throw new InterviewValidationError("missing_provenance", "Record what the user said before moving on.");
  }
  const answer: AnswerRecord = {
    fieldId,
    status: disposition === "unknown" ? "needs_followup" : "skipped",
    value: null,
    rawAnswer: wording,
    normalizedAnswer: null,
    confidence: 1,
    followUpQuestion: disposition === "unknown" ? `Revisit ${field.label} during review.` : null,
    source: "voice",
    memoryClaimId: null,
    updatedAt: timestamp
  };
  return formSessionSchema.parse({
    ...session,
    version: session.version + 1,
    updatedAt: timestamp,
    answers: { ...session.answers, [fieldId]: answer }
  });
}

export function buildInterviewContext(
  session: FormSession,
  memory: SessionMemoryContext = {
    suggestions: [],
    rememberableAnswers: [],
    confirmedPrefills: []
  }
): InterviewContext {
  const summary = summarizeSession(session);
  const remainingQuestions = getRemainingQuestions(session);
  return {
    sessionId: session.id,
    sessionVersion: session.version,
    formTitle: session.form.title,
    locale: session.form.locale,
    completionPercent: summary.completionPercent,
    requiredOpen: summary.requiredOpen,
    answeredFieldIds: Object.values(session.answers)
      .filter((answer) => answer.status === "answered")
      .map((answer) => answer.fieldId),
    skippedFieldIds: Object.values(session.answers)
      .filter((answer) => answer.status === "skipped")
      .map((answer) => answer.fieldId),
    nextQuestion: remainingQuestions[0] ?? null,
    remainingQuestions,
    memory
  };
}

export function getRemainingQuestions(session: FormSession): InterviewQuestion[] {
  return session.form.sections.flatMap((section) => section.fields
    .filter((field) => isFieldInterviewable(field)
      && isFieldApplicable(session, field)
      && isOpen(session.answers[field.id]))
    .map((field) => ({
      fieldId: field.id,
      sectionTitle: section.title,
      label: field.label,
      prompt: field.interviewPrompt,
      type: field.type,
      required: field.required,
      options: field.options,
      examples: field.examples.slice(0, 3)
    })));
}

export function buildFinishResult(session: FormSession): {
  canFinish: boolean;
  requiredOpen: number;
  remainingQuestionIds: string[];
  blockerMessages: string[];
} {
  const verification = verifySession(session);
  const remaining = getRemainingQuestions(session);
  return {
    canFinish: verification.readyForFinalExport && remaining.length === 0,
    requiredOpen: summarizeSession(session).requiredOpen,
    remainingQuestionIds: remaining.map((question) => question.fieldId),
    blockerMessages: verification.issues
      .filter((issue) => issue.severity === "blocker")
      .map((issue) => issue.message)
  };
}

function requireField(session: FormSession, fieldId: string): FormField {
  const field = listFields(session.form).find((candidate) => candidate.id === fieldId);
  if (!field) throw new InterviewValidationError("unknown_field", `Unknown field: ${fieldId}.`);
  return field;
}

function isOpen(answer: AnswerRecord | undefined): boolean {
  return !answer || answer.status === "unanswered" || answer.status === "needs_followup";
}
