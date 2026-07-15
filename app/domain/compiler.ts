import {
  compilationReadinessSchema,
  formDefinitionSchema,
  type CompilationIssue,
  type CompilationReadiness,
  type FormCompilerOutput,
  type FormDefinition,
  type FormField
} from "./schemas";
import { isSafeMemoryCandidate } from "./memory";
import { canonicalizeLocale, normalizeLocale } from "./locale";

const LOW_CONFIDENCE_BLOCKER = 0.7;
const LOW_CONFIDENCE_WARNING = 0.85;

export interface CompilationSource {
  fileName: string;
  format: FormDefinition["source"]["format"];
  searchableText: string | null;
}

export function enforceCompilerSafety(output: FormCompilerOutput): FormCompilerOutput {
  return {
    ...output,
    sections: output.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => field.memoryKey === null
        || isSafeMemoryCandidate(field, field.memoryKey) ? field : {
        ...field,
        memoryKey: null,
        memoryCandidateReason: null
      })
    }))
  };
}

export function toFormDefinition(output: FormCompilerOutput, source: CompilationSource): FormDefinition {
  return formDefinitionSchema.parse({
    id: slug(output.document.title),
    version: "ai-compiled-1",
    title: output.document.title,
    locale: normalizeLocale(output.document.locale),
    source: {
      fileName: source.fileName,
      format: source.format
    },
    prefillFields: output.sections.flatMap((section) => section.fields)
      .filter((field) => field.memoryKey !== null)
      .map((field) => ({
        id: field.id,
        label: field.label,
        memoryKey: field.memoryKey as string
      })),
    sections: output.sections
  });
}

export function evaluateCompilation(
  output: FormCompilerOutput,
  sourceText: string | null
): CompilationReadiness {
  const issues: CompilationIssue[] = [];
  const fields = output.sections.flatMap((section) => section.fields);
  const fieldIds = new Set(fields.map((field) => field.id));
  const allIds = [...output.sections.map((section) => section.id), ...fields.map((field) => field.id)];
  const duplicateIds = allIds.filter((id, index) => allIds.indexOf(id) !== index);

  if (!output.document.isForm) {
    issues.push(issue("document:not-a-form", "blocker", "not_a_form", null,
      "This document does not appear to contain questions or fields to complete."));
  }
  if (fields.length === 0) {
    issues.push(issue("document:no-fields", "blocker", "no_fields", null,
      "No form questions were found. Try a clearer scan or a different file."));
  }
  if (!canonicalizeLocale(output.document.locale)) {
    issues.push(issue("document:invalid-locale", "warning", "invalid_locale", null,
      "The form language could not be identified reliably. Voice will use automatic language detection."));
  }
  for (const id of new Set(duplicateIds)) {
    issues.push(issue(`${id}:duplicate`, "blocker", "duplicate_id", null,
      `The compiler reused the identifier “${id}”.`));
  }

  for (const field of fields) evaluateField(field, fieldIds, sourceText, issues);
  for (const [index, warning] of output.warnings.entries()) {
    issues.push(issue(`model-warning:${index}`, "warning", "model_warning", null, warning));
  }

  const evidenceFields = fields.filter((field) => field.evidence.length > 0).length;
  const lowConfidenceCount = fields.filter((field) => maxConfidence(field) < LOW_CONFIDENCE_WARNING).length;
  const blockerCount = issues.filter((item) => item.severity === "blocker").length;
  const warningCount = issues.length - blockerCount;
  const evidenceCoveragePercent = fields.length === 0 ? 0 : Math.round((evidenceFields / fields.length) * 100);
  const score = Math.max(0, Math.min(100,
    evidenceCoveragePercent - (blockerCount * 20) - (warningCount * 4)
  ));

  return compilationReadinessSchema.parse({
    ready: blockerCount === 0,
    score,
    fieldCount: fields.length,
    requiredFieldCount: fields.filter((field) => field.required).length,
    evidenceCoveragePercent,
    lowConfidenceCount,
    issues
  });
}

function evaluateField(
  field: FormField,
  fieldIds: Set<string>,
  sourceText: string | null,
  issues: CompilationIssue[]
): void {
  if (field.evidence.length === 0) {
    issues.push(issue(`${field.id}:missing-evidence`, "blocker", "missing_evidence", field.id,
      `“${field.label}” has no source evidence and will not be accepted.`));
  } else {
    const confidence = maxConfidence(field);
    if (confidence < LOW_CONFIDENCE_BLOCKER) {
      issues.push(issue(`${field.id}:confidence-blocker`, "blocker", "low_confidence", field.id,
        `“${field.label}” is too uncertain to use without a clearer document.`));
    } else if (confidence < LOW_CONFIDENCE_WARNING) {
      issues.push(issue(`${field.id}:confidence-warning`, "warning", "low_confidence", field.id,
        `Please check whether “${field.label}” matches the original form.`));
    }

    if (sourceText && !field.evidence.some((evidence) => evidenceAppearsInSource(evidence.text, sourceText))) {
      issues.push(issue(`${field.id}:unsupported-evidence`, "blocker", "unsupported_evidence", field.id,
        `The quoted source for “${field.label}” could not be found in the extracted document text.`));
    } else if (!sourceText && !field.evidence.some((evidence) => evidence.page !== null)) {
      issues.push(issue(`${field.id}:unlocated-evidence`, "blocker", "unsupported_evidence", field.id,
        `“${field.label}” needs a page reference because no searchable document text was available.`));
    }
  }

  for (const dependency of field.dependencies) {
    if (!fieldIds.has(dependency.fieldId) || dependency.fieldId === field.id) {
      issues.push(issue(`${field.id}:dependency:${dependency.fieldId}`, "blocker", "invalid_dependency", field.id,
        `The condition for “${field.label}” points to an unknown question.`));
    }
  }

  const validation = field.validation;
  if ((validation.minLength !== null && validation.maxLength !== null && validation.minLength > validation.maxLength)
    || (validation.minValue !== null && validation.maxValue !== null && validation.minValue > validation.maxValue)) {
    issues.push(issue(`${field.id}:validation`, "blocker", "invalid_validation", field.id,
      `The validation limits for “${field.label}” conflict.`));
  }
  if ((field.type === "single_choice" || field.type === "multi_choice") && field.options.length === 0) {
    issues.push(issue(`${field.id}:options`, "blocker", "choice_without_options", field.id,
      `“${field.label}” is a choice question, but no choices were found.`));
  }
  if (field.renderTargets.length === 0) {
    issues.push(issue(`${field.id}:render-target`, "blocker", "missing_render_target", field.id,
      `VocaForm does not yet know where to place “${field.label}” in the result.`));
  }
  if (field.memoryKey !== null && !isSafeMemoryCandidate(field, field.memoryKey)) {
    issues.push(issue(`${field.id}:memory`, "blocker", "unsafe_memory_candidate", field.id,
      `“${field.label}” is not a safe stable contact fact and cannot be proposed for memory automatically.`));
  }
}

function evidenceAppearsInSource(evidence: string, source: string): boolean {
  const needle = normalize(evidence);
  const haystack = normalize(source);
  if (needle.length < 3) return false;
  return haystack.includes(needle);
}

function maxConfidence(field: FormField): number {
  return field.evidence.reduce((maximum, evidence) => Math.max(maximum, evidence.confidence), 0);
}

function normalize(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "_").slice(0, 64) || "uploaded_form";
}

function issue(
  id: string,
  severity: CompilationIssue["severity"],
  kind: CompilationIssue["kind"],
  fieldId: string | null,
  message: string
): CompilationIssue {
  return { id, severity, kind, fieldId, message };
}
