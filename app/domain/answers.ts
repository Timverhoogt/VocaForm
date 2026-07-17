import type { AnswerValue, FormField } from "./schemas";
import { isWebFormField } from "./form_definition";

export class AnswerValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function parseTextAnswer(field: FormField, input: string): AnswerValue {
  const normalized = input.trim();
  if (!normalized) throw new AnswerValidationError("empty_answer", "An answer cannot be empty.");
  if (field.type === "file_upload" || field.type === "unsupported") {
    throw new AnswerValidationError(
      "unsupported_control",
      `${field.label} uses a control that cannot be answered safely in this delivery path.`
    );
  }
  if (field.type === "matrix") {
    throw new AnswerValidationError(
      "structured_answer_required",
      `${field.label} requires a structured row-by-row answer.`
    );
  }

  let value: AnswerValue = normalized;
  if (field.type === "number" || field.type === "scale" || field.type === "rating") {
    value = Number(normalized.replace(",", "."));
  } else if (field.type === "boolean") {
    const comparable = normalizeComparable(normalized);
    if (["yes", "y", "true", "1", "ja"].includes(comparable)) value = true;
    else if (["no", "n", "false", "0", "nee"].includes(comparable)) value = false;
  } else if (field.type === "multi_choice") {
    value = normalized.split(/[,;\n]+/).map((item) => canonicalChoice(field, item)).filter(Boolean);
  } else if (field.type === "ranking") {
    value = normalized.split(/[,;\n]+/).map((item) => canonicalChoice(field, item)).filter(Boolean);
  } else if (field.type === "single_choice") {
    value = canonicalChoice(field, normalized);
  }

  validateAnswerValue(field, value);
  return value;
}

export function validateAnswerValue(field: FormField, value: AnswerValue): void {
  if (field.type === "file_upload" || field.type === "unsupported") {
    throw new AnswerValidationError(
      "unsupported_control",
      `${field.label} uses a control that cannot be answered safely in this delivery path.`
    );
  }
  if (field.type === "number" || field.type === "scale" || field.type === "rating") {
    if (typeof value !== "number" || !Number.isFinite(value)) return failType(field, "a number");
    if (field.validation.minValue !== null && value < field.validation.minValue) {
      throw new AnswerValidationError("below_minimum", `${field.label} is below the allowed minimum.`);
    }
    if (field.validation.maxValue !== null && value > field.validation.maxValue) {
      throw new AnswerValidationError("above_maximum", `${field.label} is above the allowed maximum.`);
    }
    return;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") failType(field, "true or false");
    return;
  }
  if (field.type === "multi_choice") {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
      return failType(field, "a non-empty list of choices");
    }
    validateAllowedValues(field, value);
    return;
  }
  if (field.type === "ranking") {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
      return failType(field, "an ordered list of choices");
    }
    if (new Set(value.map(normalizeComparable)).size !== value.length) {
      throw new AnswerValidationError("duplicate_ranking_choice", `${field.label} repeats a ranked choice.`);
    }
    validateAllowedValues(field, value);
    return;
  }
  if (field.type === "matrix") {
    if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
      return failType(field, "a row-by-row choice map");
    }
    const entries = Object.entries(value);
    if (isWebFormField(field) && field.matrixRows.length > 0
      && entries.some(([row]) => !field.matrixRows.includes(row))) {
      throw new AnswerValidationError("matrix_row_not_allowed", `${field.label} contains an unknown matrix row.`);
    }
    const allowedColumns = isWebFormField(field) && field.matrixColumns.length > 0
      ? field.matrixColumns
      : field.options;
    const values = entries.flatMap(([, answer]) => Array.isArray(answer) ? answer : [answer]);
    if (values.some((answer) => typeof answer !== "string" || !answer.trim())) {
      return failType(field, "non-empty matrix choices");
    }
    if (allowedColumns.length > 0) validateChoices(field, values, allowedColumns);
    return;
  }
  if (typeof value !== "string" || !value.trim()) return failType(field, "text");
  const normalized = value.trim();
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AnswerValidationError("invalid_email", `${field.label} is not a valid email address.`);
  }
  if (field.type === "phone" && normalized.replace(/\D/g, "").length < 5) {
    throw new AnswerValidationError("invalid_phone", `${field.label} is not a usable phone number.`);
  }
  if (field.type === "date" && !isIsoDate(normalized)) {
    throw new AnswerValidationError("invalid_date", `${field.label} must use YYYY-MM-DD.`);
  }
  if (field.type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new AnswerValidationError("invalid_time", `${field.label} must use HH:MM in 24-hour time.`);
  }
  if (field.type === "single_choice") validateAllowedValues(field, [normalized]);
  if (field.validation.minLength !== null && normalized.length < field.validation.minLength) {
    throw new AnswerValidationError("below_minimum_length", `${field.label} is too short.`);
  }
  if (field.validation.maxLength !== null && normalized.length > field.validation.maxLength) {
    throw new AnswerValidationError("above_maximum_length", `${field.label} is too long.`);
  }
  if (field.validation.pattern !== null) {
    try {
      if (!new RegExp(field.validation.pattern).test(normalized)) {
        throw new AnswerValidationError("pattern_mismatch", `${field.label} does not match the form's format.`);
      }
    } catch (error) {
      if (error instanceof AnswerValidationError) throw error;
      throw new AnswerValidationError("invalid_pattern", `${field.label} has an unusable validation pattern.`);
    }
  }
}

export function formatNormalizedAnswer(value: AnswerValue): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([row, answer]) => `${row}: ${Array.isArray(answer) ? answer.join(", ") : answer}`)
      .join("; ");
  }
  return String(value).trim();
}

function canonicalChoice(field: FormField, value: string): string {
  const trimmed = value.trim();
  const allowed = field.options.length > 0 ? field.options : field.validation.allowedValues;
  return allowed.find((item) => normalizeComparable(item) === normalizeComparable(trimmed)) ?? trimmed;
}

function validateAllowedValues(field: FormField, values: string[]): void {
  const allowed = field.options.length > 0 ? field.options : field.validation.allowedValues;
  if (allowed.length === 0) return;
  validateChoices(field, values, allowed);
}

function validateChoices(field: FormField, values: string[], allowed: string[]): void {
  const normalizedAllowed = allowed.map(normalizeComparable);
  if (values.some((value) => !normalizedAllowed.includes(normalizeComparable(value)))) {
    throw new AnswerValidationError("choice_not_allowed", `${field.label} contains a choice not shown on the form.`);
  }
}

function failType(field: FormField, expected: string): never {
  throw new AnswerValidationError("invalid_type", `${field.label} requires ${expected}.`);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

function normalizeComparable(value: string): string {
  return value.trim().toLocaleLowerCase();
}
