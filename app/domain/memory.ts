import { validateAnswerValue } from "./answers";
import {
  formSessionSchema,
  memoryVaultSchema,
  type AnswerRecord,
  type AnswerValue,
  type FormField,
  type FormSession,
  type MemoryClaim,
  type MemoryVault
} from "./schemas";
import { findField, listFields } from "./session";

export type MemoryConsentChannel = "ui" | "voice";

export interface MemoryConsentInput {
  channel: MemoryConsentChannel;
  confirmationWording?: string | null;
}

export interface RememberableAnswer {
  fieldId: string;
  fieldLabel: string;
  subject: string;
  key: string;
  value: AnswerValue;
  originalWording: string;
  reason: string;
  action: "remember" | "update";
}

export interface MemorySuggestion {
  claimId: string;
  fieldId: string;
  fieldLabel: string;
  target: "answer" | "prefill";
  subject: string;
  key: string;
  value: AnswerValue;
  originalWording: string;
  sourceFormTitle: string;
  confirmedAt: string;
}

export interface ConfirmedPrefill {
  fieldId: string;
  fieldLabel: string;
  claimId: string;
  value: AnswerValue;
}

export interface SessionMemoryContext {
  suggestions: MemorySuggestion[];
  rememberableAnswers: RememberableAnswer[];
  confirmedPrefills: ConfirmedPrefill[];
}

export class MemoryValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function createEmptyMemoryVault(now = new Date()): MemoryVault {
  return memoryVaultSchema.parse({
    schemaVersion: 1,
    version: 0,
    claims: [],
    updatedAt: now.toISOString()
  });
}

export function buildSessionMemoryContext(
  vault: MemoryVault,
  session: FormSession,
  now = new Date()
): SessionMemoryContext {
  const activeClaims = vault.claims.filter((claim) => isActiveClaim(claim, now));
  const targets = listMemoryTargets(session);
  const suggestions = targets.flatMap((target): MemorySuggestion[] => {
    const answer = target.target === "answer"
      ? session.answers[target.fieldId]
      : session.prefillAnswers[target.fieldId];
    if (answer?.status === "answered") return [];

    return activeClaims
      .filter((claim) => claim.key === target.key && claim.sensitivity === "standard")
      .filter((claim) => !target.field || canApplyValue(target.field, claim.value))
      .map((claim) => ({
        claimId: claim.id,
        fieldId: target.fieldId,
        fieldLabel: target.fieldLabel,
        target: target.target,
        subject: claim.subject,
        key: claim.key,
        value: claim.value,
        originalWording: claim.originalWording,
        sourceFormTitle: claim.sourceFormTitle || claim.sourceFormId,
        confirmedAt: claim.confirmedAt as string
      }));
  });

  const rememberableAnswers = listFields(session.form).flatMap((field): RememberableAnswer[] => {
    const answer = session.answers[field.id];
    const key = memoryKeyForField(session, field);
    if (!answer || answer.status !== "answered" || answer.value === null || !key) return [];
    if (answer.source === "memory" || answer.source === "import") return [];
    if (!isSafeMemoryCandidate(field, key)) return [];
    const originalWording = answer.rawAnswer?.trim() || answer.normalizedAnswer?.trim();
    if (!originalWording) return [];
    const subject = inferMemorySubject(key);
    const existing = activeClaims.find((claim) => sameSubject(claim.subject, subject) && claim.key === key);
    if (existing && valuesEqual(existing.value, answer.value)) return [];
    return [{
      fieldId: field.id,
      fieldLabel: field.label,
      subject,
      key,
      value: answer.value,
      originalWording,
      reason: field.memoryCandidateReason || "This stable contact detail can save time on another form.",
      action: existing ? "update" : "remember"
    }];
  });

  const confirmedPrefills = Object.values(session.prefillAnswers).flatMap((answer): ConfirmedPrefill[] => {
    if (answer.status !== "answered" || answer.source !== "memory" || !answer.memoryClaimId || answer.value === null) {
      return [];
    }
    const descriptor = session.form.prefillFields.find((field) => field.id === answer.fieldId);
    if (!descriptor) return [];
    return [{
      fieldId: answer.fieldId,
      fieldLabel: descriptor.label,
      claimId: answer.memoryClaimId,
      value: answer.value
    }];
  });

  return { suggestions, rememberableAnswers, confirmedPrefills };
}

export function rememberSessionAnswer(
  vault: MemoryVault,
  session: FormSession,
  fieldId: string,
  subject: string,
  consent: MemoryConsentInput,
  now = new Date(),
  expiresAt: Date | null = null
): MemoryVault {
  const field = findField(session.form, fieldId);
  if (!field) throw new MemoryValidationError("unknown_field", `Unknown field: ${fieldId}.`);
  const key = memoryKeyForField(session, field);
  if (!key || !isSafeMemoryCandidate(field, key)) {
    throw new MemoryValidationError("not_rememberable", `${field.label} is not eligible for memory.`);
  }
  const answer = session.answers[field.id];
  if (!answer || answer.status !== "answered" || answer.value === null) {
    throw new MemoryValidationError("answer_missing", `Answer ${field.label} before asking VocaForm to remember it.`);
  }
  if (answer.source === "memory" || answer.source === "import") {
    throw new MemoryValidationError("unsupported_source", "Only a new answer or explicit correction can be remembered.");
  }
  requireExplicitConsent(consent);
  const normalizedSubject = subject.trim();
  if (!normalizedSubject) throw new MemoryValidationError("subject_missing", "Choose who this fact is about.");
  const timestamp = now.toISOString();
  const originalWording = answer.rawAnswer?.trim() || answer.normalizedAnswer?.trim();
  if (!originalWording) {
    throw new MemoryValidationError("provenance_missing", "The answer's original wording is missing.");
  }
  const existingIndex = vault.claims.findIndex(
    (claim) => sameSubject(claim.subject, normalizedSubject) && claim.key === key
  );
  const existing = existingIndex >= 0 ? vault.claims[existingIndex] : null;
  const claim: MemoryClaim = {
    id: existing?.id ?? crypto.randomUUID(),
    subject: normalizedSubject,
    key,
    value: answer.value,
    originalWording,
    sensitivity: field.sensitivity,
    sourceFormId: session.form.id,
    sourceFieldId: field.id,
    sourceFormTitle: session.form.title,
    sourceFieldLabel: field.label,
    sourceSessionId: session.id,
    sourceAnswerSource: answer.source,
    sourceAnsweredAt: answer.updatedAt,
    consent: "approved",
    consentChannel: consent.channel,
    confirmationWording: normalizeConfirmationWording(consent),
    confirmedAt: timestamp,
    expiresAt: expiresAt?.toISOString() ?? null,
    correctedAt: existing ? timestamp : null
  };
  const claims = [...vault.claims];
  if (existingIndex >= 0) claims[existingIndex] = claim;
  else claims.push(claim);
  return memoryVaultSchema.parse({
    ...vault,
    version: vault.version + 1,
    claims,
    updatedAt: timestamp
  });
}

export function confirmMemoryClaimForSession(
  session: FormSession,
  vault: MemoryVault,
  fieldId: string,
  claimId: string,
  consent: MemoryConsentInput,
  now = new Date()
): FormSession {
  requireExplicitConsent(consent);
  const claim = vault.claims.find((candidate) => candidate.id === claimId);
  if (!claim || !isActiveClaim(claim, now)) {
    throw new MemoryValidationError("claim_unavailable", "That remembered fact is no longer available.");
  }
  const target = listMemoryTargets(session).find(
    (candidate) => candidate.fieldId === fieldId && candidate.key === claim.key
  );
  if (!target) {
    throw new MemoryValidationError("claim_mismatch", "That remembered fact does not match this form field.");
  }
  const current = target.target === "answer"
    ? session.answers[fieldId]
    : session.prefillAnswers[fieldId];
  if (!current || current.status === "answered") {
    throw new MemoryValidationError("field_already_answered", `${target.fieldLabel} already has an answer.`);
  }
  if (target.field) validateAnswerValue(target.field, claim.value);
  const timestamp = now.toISOString();
  const record: AnswerRecord = {
    fieldId,
    status: "answered",
    value: claim.value,
    rawAnswer: normalizeConfirmationWording(consent) || "Confirmed using the Memory Vault.",
    normalizedAnswer: formatMemoryValue(claim.value),
    confidence: 1,
    followUpQuestion: null,
    source: "memory",
    memoryClaimId: claim.id,
    updatedAt: timestamp
  };
  return formSessionSchema.parse({
    ...session,
    version: session.version + 1,
    updatedAt: timestamp,
    answers: target.target === "answer"
      ? { ...session.answers, [fieldId]: record }
      : session.answers,
    prefillAnswers: target.target === "prefill"
      ? { ...session.prefillAnswers, [fieldId]: record }
      : session.prefillAnswers
  });
}

export function correctMemoryClaim(
  vault: MemoryVault,
  claimId: string,
  value: AnswerValue,
  now = new Date()
): MemoryVault {
  requireUsableValue(value);
  const index = vault.claims.findIndex((claim) => claim.id === claimId);
  if (index < 0) throw new MemoryValidationError("claim_not_found", "That remembered fact was not found.");
  const timestamp = now.toISOString();
  const claims = [...vault.claims];
  claims[index] = { ...claims[index] as MemoryClaim, value, correctedAt: timestamp };
  return memoryVaultSchema.parse({
    ...vault,
    version: vault.version + 1,
    claims,
    updatedAt: timestamp
  });
}

export function forgetMemoryClaim(
  vault: MemoryVault,
  claimId: string,
  now = new Date()
): MemoryVault {
  if (!vault.claims.some((claim) => claim.id === claimId)) {
    throw new MemoryValidationError("claim_not_found", "That remembered fact was not found.");
  }
  return memoryVaultSchema.parse({
    ...vault,
    version: vault.version + 1,
    claims: vault.claims.filter((claim) => claim.id !== claimId),
    updatedAt: now.toISOString()
  });
}

export function inferMemorySubject(key: string): string {
  if (key === "parents_or_guardians" || key.includes("guardian") || key.includes("parent")) {
    return "Parent or guardian";
  }
  if (key.includes("child")) return "Child";
  if (key.includes("household") || key.endsWith("address")) return "Household";
  return "You";
}

export function isActiveClaim(claim: MemoryClaim, now = new Date()): boolean {
  if (claim.consent !== "approved" || claim.confirmedAt === null) return false;
  return claim.expiresAt === null || new Date(claim.expiresAt).valueOf() > now.valueOf();
}

export function formatMemoryValue(value: AnswerValue): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

export function isSafeMemoryCandidate(field: FormField, key: string): boolean {
  return field.sensitivity === "standard"
    && isSafeMemoryKey(key)
    && ["short_text", "email", "phone"].includes(field.type);
}

interface MemoryTarget {
  fieldId: string;
  fieldLabel: string;
  key: string;
  target: "answer" | "prefill";
  field: FormField | null;
}

function listMemoryTargets(session: FormSession): MemoryTarget[] {
  const targets = new Map<string, MemoryTarget>();
  for (const descriptor of session.form.prefillFields) {
    if (!isSafeMemoryKey(descriptor.memoryKey)) continue;
    const field = findField(session.form, descriptor.id);
    if (field && !isSafeMemoryCandidate(field, descriptor.memoryKey)) continue;
    targets.set(descriptor.id, {
      fieldId: descriptor.id,
      fieldLabel: descriptor.label,
      key: descriptor.memoryKey,
      target: field ? "answer" : "prefill",
      field
    });
  }
  for (const field of listFields(session.form)) {
    if (!field.memoryKey || targets.has(field.id) || !isSafeMemoryCandidate(field, field.memoryKey)) continue;
    targets.set(field.id, {
      fieldId: field.id,
      fieldLabel: field.label,
      key: field.memoryKey,
      target: "answer",
      field
    });
  }
  return [...targets.values()];
}

function memoryKeyForField(session: FormSession, field: FormField): string | null {
  return session.form.prefillFields.find((candidate) => candidate.id === field.id)?.memoryKey
    ?? field.memoryKey;
}

function isSafeMemoryKey(key: string): boolean {
  const normalized = key.trim().toLocaleLowerCase();
  if (!/^[a-z0-9]+(?:[._][a-z0-9]+)*$/.test(normalized)) return false;
  const denied = [
    "allerg", "bank", "birth", "consent", "diagnos", "document", "financial", "health",
    "iban", "identity", "medical", "medication", "passport", "photo", "ssn", "support"
  ];
  if (denied.some((token) => normalized.includes(token))) return false;
  return ["name", "full_name", "phone", "telephone", "email", "address", "city", "postcode", "postal_code"]
    .some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`) || normalized.endsWith(`_${suffix}`))
    || normalized === "parents_or_guardians";
}

function canApplyValue(field: FormField, value: AnswerValue): boolean {
  try {
    validateAnswerValue(field, value);
    return true;
  } catch {
    return false;
  }
}

function requireExplicitConsent(consent: MemoryConsentInput): void {
  if (consent.channel !== "ui" && consent.channel !== "voice") {
    throw new MemoryValidationError("consent_missing", "Explicit permission is required.");
  }
  if (consent.channel === "voice" && !consent.confirmationWording?.trim()) {
    throw new MemoryValidationError("consent_provenance_missing", "Record the user's spoken confirmation.");
  }
}

function normalizeConfirmationWording(consent: MemoryConsentInput): string | null {
  return consent.confirmationWording?.trim() || null;
}

function requireUsableValue(value: AnswerValue): void {
  if (typeof value === "string" && !value.trim()) {
    throw new MemoryValidationError("value_missing", "A remembered value cannot be empty.");
  }
  if (Array.isArray(value) && (value.length === 0 || value.some((item) => !item.trim()))) {
    throw new MemoryValidationError("value_missing", "A remembered list cannot be empty.");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new MemoryValidationError("value_invalid", "A remembered number must be finite.");
  }
}

function valuesEqual(left: AnswerValue, right: AnswerValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSubject(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}
