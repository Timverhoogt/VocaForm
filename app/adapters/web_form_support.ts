import type { FieldType, WebFormProvider } from "../domain/schemas";
import type { WebFormQuestionType } from "./web_form_inspection";

export type WebFormSupportLevel = "deterministic" | "manual" | "blocked";

export interface WebFormControlSupportEntry {
  controlType: WebFormQuestionType;
  interview: WebFormSupportLevel;
  nativePreparation: Record<WebFormProvider, WebFormSupportLevel>;
  note: string;
}

const DETERMINISTIC_TYPES = new Set<WebFormQuestionType>([
  "short_text",
  "long_text",
  "email",
  "phone",
  "date",
  "time",
  "number",
  "single_choice",
  "multi_choice",
  "scale",
  "rating"
]);

const CONTROL_TYPES: WebFormQuestionType[] = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "date",
  "time",
  "number",
  "single_choice",
  "multi_choice",
  "scale",
  "rating",
  "ranking",
  "matrix",
  "file_upload",
  "unknown"
];

export const WEB_FORM_SUPPORTED_CONTROL_MATRIX: WebFormControlSupportEntry[] = CONTROL_TYPES.map(
  (controlType) => {
    const deterministic = DETERMINISTIC_TYPES.has(controlType);
    const blocked = controlType === "file_upload" || controlType === "unknown";
    return {
      controlType,
      interview: deterministic ? "deterministic" : blocked ? "blocked" : "manual",
      nativePreparation: {
        google_forms: deterministic ? "deterministic" : blocked ? "blocked" : "manual",
        microsoft_forms: deterministic ? "deterministic" : blocked ? "blocked" : "manual"
      },
      note: supportNote(controlType)
    };
  }
);

export function supportsDeterministicWebFormInterview(type: WebFormQuestionType): boolean {
  return DETERMINISTIC_TYPES.has(type);
}

export function supportsNativeWebFormPreparation(type: FieldType, provider: WebFormProvider): boolean {
  if (type === "boolean") return true;
  const entry = WEB_FORM_SUPPORTED_CONTROL_MATRIX.find((candidate) => candidate.controlType === type);
  return entry?.nativePreparation[provider] === "deterministic";
}

function supportNote(type: WebFormQuestionType): string {
  if (type === "ranking" || type === "matrix") {
    return "Preserved in the answer list; complete this control in the provider form.";
  }
  if (type === "file_upload") {
    return "Blocked because file transfer and provider authentication require a separate consent boundary.";
  }
  if (type === "unknown") {
    return "Blocked because VocaForm will not guess an unrecognized provider control.";
  }
  return "Interviewed, placed through deterministic locators, and re-read before the user-only Submit action.";
}
