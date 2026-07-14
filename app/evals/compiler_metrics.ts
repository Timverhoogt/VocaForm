import { listFields } from "../domain/session";
import type { FormDefinition } from "../domain/schemas";

export interface GoldenAnswerKey {
  fieldIds: string[];
  fieldLabelsById: Record<string, string>;
  fieldEvidenceById: Record<string, string[]>;
  requiredFieldIds: string[];
  dependencies: Array<{ fieldId: string; dependsOn: string }>;
}

export interface CompilerMetrics {
  expectedFields: number;
  detectedExpectedFields: number;
  requiredFields: number;
  detectedRequiredFields: number;
  fabricatedFieldIds: string[];
  missingFieldIds: string[];
  missingRequiredFieldIds: string[];
  missingDependencies: string[];
  fieldRecallPercent: number;
  requiredRecallPercent: number;
}

export function evaluateCompilerForm(form: FormDefinition, key: GoldenAnswerKey): CompilerMetrics {
  const fields = listFields(form);
  const matches = matchExpectedFields(fields, key);
  const matchedDetectedIds = new Set([...matches.values()].map((field) => field.id));
  const missingFieldIds = key.fieldIds.filter((id) => !matches.has(id));
  const missingRequiredFieldIds = key.requiredFieldIds.filter((id) => !matches.get(id)?.required);
  const fabricatedFieldIds = fields
    .map((field) => field.id)
    .filter((id) => !matchedDetectedIds.has(id));
  const missingDependencies = key.dependencies
    .filter(({ fieldId, dependsOn }) => {
      const field = matches.get(fieldId);
      const parent = matches.get(dependsOn);
      return !field || !parent
        || !field.dependencies.some((dependency) => dependency.fieldId === parent.id);
    })
    .map(({ fieldId, dependsOn }) => `${fieldId}->${dependsOn}`);

  return {
    expectedFields: key.fieldIds.length,
    detectedExpectedFields: key.fieldIds.length - missingFieldIds.length,
    requiredFields: key.requiredFieldIds.length,
    detectedRequiredFields: key.requiredFieldIds.length - missingRequiredFieldIds.length,
    fabricatedFieldIds,
    missingFieldIds,
    missingRequiredFieldIds,
    missingDependencies,
    fieldRecallPercent: percent(key.fieldIds.length - missingFieldIds.length, key.fieldIds.length),
    requiredRecallPercent: percent(
      key.requiredFieldIds.length - missingRequiredFieldIds.length,
      key.requiredFieldIds.length
    )
  };
}

function matchExpectedFields(
  fields: ReturnType<typeof listFields>,
  key: GoldenAnswerKey
): Map<string, ReturnType<typeof listFields>[number]> {
  const matches = new Map<string, ReturnType<typeof listFields>[number]>();
  const available = new Map(fields.map((field) => [field.id, field]));

  // Prefer an exact stable ID. Live model output can still be evaluated fairly
  // when it emits a different valid ID for the same verbatim form label.
  for (const expectedId of key.fieldIds) {
    const exact = available.get(expectedId);
    if (!exact) continue;
    matches.set(expectedId, exact);
    available.delete(exact.id);
  }

  for (const expectedId of key.fieldIds) {
    if (matches.has(expectedId)) continue;
    const expectedLabel = normalizeLabel(key.fieldLabelsById[expectedId] ?? "");
    if (!expectedLabel) continue;
    const candidates = [...available.values()].filter(
      (field) => normalizeLabel(field.label) === expectedLabel
    );
    if (candidates.length !== 1) continue;
    const [match] = candidates;
    matches.set(expectedId, match!);
    available.delete(match!.id);
  }

  for (const expectedId of key.fieldIds) {
    if (matches.has(expectedId)) continue;
    const expectedEvidence = key.fieldEvidenceById[expectedId] ?? [];
    const candidates = [...available.values()].filter((field) =>
      field.evidence.some((detected) =>
        expectedEvidence.some((expected) => equivalentEvidence(detected.text, expected))
      )
    );
    if (candidates.length !== 1) continue;
    const [match] = candidates;
    matches.set(expectedId, match!);
    available.delete(match!.id);
  }

  return matches;
}

function equivalentEvidence(left: string, right: string): boolean {
  const normalizedLeft = normalizeLabel(left);
  const normalizedRight = normalizeLabel(right);
  if (normalizedLeft === normalizedRight) return true;
  if (Math.min(normalizedLeft.length, normalizedRight.length) < 12) return false;
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\b(required|optional|verplicht|optioneel)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function aggregateCompilerMetrics(results: CompilerMetrics[]): CompilerMetrics {
  const expectedFields = sum(results, "expectedFields");
  const detectedExpectedFields = sum(results, "detectedExpectedFields");
  const requiredFields = sum(results, "requiredFields");
  const detectedRequiredFields = sum(results, "detectedRequiredFields");
  return {
    expectedFields,
    detectedExpectedFields,
    requiredFields,
    detectedRequiredFields,
    fabricatedFieldIds: results.flatMap((result) => result.fabricatedFieldIds),
    missingFieldIds: results.flatMap((result) => result.missingFieldIds),
    missingRequiredFieldIds: results.flatMap((result) => result.missingRequiredFieldIds),
    missingDependencies: results.flatMap((result) => result.missingDependencies),
    fieldRecallPercent: percent(detectedExpectedFields, expectedFields),
    requiredRecallPercent: percent(detectedRequiredFields, requiredFields)
  };
}

function percent(value: number, total: number): number {
  return total === 0 ? 100 : Math.round((value / total) * 10_000) / 100;
}

function sum(results: CompilerMetrics[], key: keyof CompilerMetrics): number {
  return results.reduce((total, result) => total + (result[key] as number), 0);
}
