export type WebFormProvider = "google_forms" | "microsoft_forms";

export type WebFormQuestionType =
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "date"
  | "time"
  | "number"
  | "single_choice"
  | "multi_choice"
  | "scale"
  | "rating"
  | "ranking"
  | "matrix"
  | "file_upload"
  | "unknown";

export type WebFormLocatorKind = "provider_id" | "accessible_label";
export type WebFormLocatorStability = "high" | "medium" | "low";

export interface WebFormLocatorCandidate {
  kind: WebFormLocatorKind;
  value: string;
  stability: WebFormLocatorStability;
}

export interface RawWebFormQuestion {
  providerFieldId: string | null;
  label: string;
  description: string | null;
  type: WebFormQuestionType;
  required: boolean;
  options: string[];
  sectionTitle: string | null;
  locatorCandidates: WebFormLocatorCandidate[];
}

export interface RawWebFormInspection {
  provider: WebFormProvider;
  title: string;
  locale?: string | null;
  description: string | null;
  sections: string[];
  questions: RawWebFormQuestion[];
  hasNextPage: boolean;
  providerSignals?: {
    markupBoundaryFound: boolean;
    questionBoundaryFound: boolean;
    nextControlFound: boolean;
    submitControlFound: boolean;
  };
  warnings: string[];
  outOfScopeReasons?: string[];
}

export interface WebFormInspectionSource {
  provider: WebFormProvider;
  origin: string;
  urlFingerprint: string;
  queryParametersRemoved: boolean;
}

export interface WebFormQuestion extends RawWebFormQuestion {
  ordinal: number;
}

export interface WebFormInspectionMetrics {
  questionCount: number;
  requiredQuestionCount: number;
  optionQuestionCount: number;
  unsupportedQuestionCount: number;
  labelCoveragePercent: number;
  recognizedTypeCoveragePercent: number;
  providerIdCoveragePercent: number;
  usableLocatorCoveragePercent: number;
  typeCounts: Record<WebFormQuestionType, number>;
}

export interface WebFormInspection {
  schemaVersion: 1;
  provider: WebFormProvider;
  source: WebFormInspectionSource | null;
  title: string;
  locale: string;
  description: string | null;
  sections: string[];
  questions: WebFormQuestion[];
  capabilities: {
    readOnly: true;
    submissionBlocked: true;
    questionValuesRead: false;
    currentPageOnly: boolean;
    hasNextPage: boolean;
  };
  metrics: WebFormInspectionMetrics;
  providerSignals: {
    markupBoundaryFound: boolean;
    questionBoundaryFound: boolean;
    nextControlFound: boolean;
    submitControlFound: boolean;
  };
  warnings: string[];
  outOfScopeReasons: string[];
}

const QUESTION_TYPES: WebFormQuestionType[] = [
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

export function finalizeWebFormInspection(
  raw: RawWebFormInspection,
  source: WebFormInspectionSource | null = null
): WebFormInspection {
  const questions = raw.questions.map((question, index) => normalizeQuestion(question, index + 1));
  const warnings = uniqueStrings(raw.warnings);
  const providerIds = questions
    .map((question) => question.providerFieldId)
    .filter((value): value is string => Boolean(value));
  const duplicateProviderIds = uniqueStrings(
    providerIds.filter((value, index) => providerIds.indexOf(value) !== index)
  );

  if (questions.length === 0) warnings.push("No user-answerable questions were found on the rendered page.");
  if (raw.hasNextPage) {
    warnings.push("Only the currently rendered page was inspected; navigation is intentionally disabled in Goal 1.");
  }
  for (const providerId of duplicateProviderIds) {
    warnings.push(`Provider field ID “${providerId}” appears more than once on this page.`);
  }

  return {
    schemaVersion: 1,
    provider: raw.provider,
    source,
    title: normalizeText(raw.title) || "Untitled web form",
    locale: normalizeText(raw.locale ?? "") || "en-US",
    description: normalizeOptionalText(raw.description),
    sections: uniqueStrings(raw.sections),
    questions,
    capabilities: {
      readOnly: true,
      submissionBlocked: true,
      questionValuesRead: false,
      currentPageOnly: raw.hasNextPage,
      hasNextPage: raw.hasNextPage
    },
    metrics: buildMetrics(questions),
    providerSignals: raw.providerSignals ?? {
      markupBoundaryFound: questions.length > 0,
      questionBoundaryFound: questions.length > 0,
      nextControlFound: raw.hasNextPage,
      submitControlFound: !raw.hasNextPage
    },
    warnings: uniqueStrings(warnings),
    outOfScopeReasons: uniqueStrings(raw.outOfScopeReasons ?? [])
  };
}

function normalizeQuestion(question: RawWebFormQuestion, ordinal: number): WebFormQuestion {
  const locatorCandidates = question.locatorCandidates
    .map((candidate) => ({
      ...candidate,
      value: normalizeText(candidate.value)
    }))
    .filter((candidate) => Boolean(candidate.value));

  return {
    ordinal,
    providerFieldId: normalizeOptionalText(question.providerFieldId),
    label: normalizeText(question.label),
    description: normalizeOptionalText(question.description),
    type: QUESTION_TYPES.includes(question.type) ? question.type : "unknown",
    required: question.required,
    options: uniqueStrings(question.options),
    sectionTitle: normalizeOptionalText(question.sectionTitle),
    locatorCandidates: uniqueLocatorCandidates(locatorCandidates)
  };
}

function buildMetrics(questions: WebFormQuestion[]): WebFormInspectionMetrics {
  const typeCounts = Object.fromEntries(
    QUESTION_TYPES.map((type) => [type, questions.filter((question) => question.type === type).length])
  ) as Record<WebFormQuestionType, number>;
  const questionCount = questions.length;

  return {
    questionCount,
    requiredQuestionCount: questions.filter((question) => question.required).length,
    optionQuestionCount: questions.filter((question) => question.options.length > 0).length,
    unsupportedQuestionCount: typeCounts.unknown,
    labelCoveragePercent: percent(questions.filter((question) => Boolean(question.label)).length, questionCount),
    recognizedTypeCoveragePercent: percent(
      questions.filter((question) => question.type !== "unknown").length,
      questionCount
    ),
    providerIdCoveragePercent: percent(
      questions.filter((question) => Boolean(question.providerFieldId)).length,
      questionCount
    ),
    usableLocatorCoveragePercent: percent(
      questions.filter((question) => question.locatorCandidates.some(
        (candidate) => candidate.stability === "high" || candidate.stability === "medium"
      )).length,
      questionCount
    ),
    typeCounts
  };
}

function uniqueStrings(values: Array<string | null>): string[] {
  const normalized = values.map((value) => normalizeText(value ?? "")).filter(Boolean);
  return [...new Set(normalized)];
}

function uniqueLocatorCandidates(values: WebFormLocatorCandidate[]): WebFormLocatorCandidate[] {
  const seen = new Set<string>();
  return values.filter((candidate) => {
    const key = `${candidate.kind}\u0000${candidate.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = normalizeText(value ?? "");
  return normalized || null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 100 : Math.round(numerator / denominator * 100);
}
