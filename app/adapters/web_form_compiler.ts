import { createHash } from "node:crypto";
import {
  webFormDefinitionSchema,
  type ValidationConstraint,
  type WebFormDefinition,
  type WebFormField
} from "../domain/schemas";
import { canonicalizeLocale } from "../domain/locale";
import type {
  WebFormInspection,
  WebFormQuestion
} from "./web_form_inspection";
import { supportsDeterministicWebFormInterview } from "./web_form_support";

export interface WebFormCompilationResult {
  form: WebFormDefinition;
  blockedFieldIds: string[];
  warnings: string[];
}

export function compileWebFormInspection(
  inspection: WebFormInspection,
  now = new Date()
): WebFormCompilationResult {
  if (!inspection.source) {
    throw new Error("A remote responder source is required before starting a web-form interview.");
  }
  if (inspection.questions.length === 0) {
    throw new Error("No interview questions were found on this responder page.");
  }
  if (inspection.outOfScopeReasons.length > 0) {
    throw new Error(inspection.outOfScopeReasons[0]);
  }

  const pageId = "page_1";
  const fieldIds = uniqueFieldIds(inspection.questions);
  const fields = inspection.questions.map((question, index) =>
    compileQuestion(question, fieldIds[index] as string, pageId)
  );
  const sections = groupSections(fields, inspection.questions);
  const observedAt = now.toISOString();
  const revisionFingerprint = fingerprint({
    provider: inspection.provider,
    title: inspection.title,
    description: inspection.description,
    sections: sections.map((section) => ({
      title: section.title,
      fields: section.fields.map((field) => ({
        providerFieldId: field.providerFieldId,
        label: field.label,
        type: field.type,
        required: field.required,
        options: field.options,
        sourceControlType: field.sourceControlType,
        locators: field.deliveryTargets.flatMap((target) => target.locatorCandidates)
      }))
    })),
    hasNextPage: inspection.capabilities.hasNextPage
  });
  const coverage = inspection.capabilities.currentPageOnly ? "current_page_only" : "complete";
  const flowEdge = inspection.capabilities.hasNextPage
    ? {
        id: "uninspected_next_page",
        kind: "unknown" as const,
        fromPageId: pageId,
        toPageId: null,
        condition: null
      }
    : {
        id: "provider_submit_boundary",
        kind: "submit" as const,
        fromPageId: pageId,
        toPageId: null,
        condition: null
      };

  const form = webFormDefinitionSchema.parse({
    id: `web_${inspection.provider}_${revisionFingerprint.slice(0, 16)}`,
    version: `web-inspection-${revisionFingerprint.slice(0, 12)}`,
    title: inspection.title,
    locale: canonicalizeLocale(inspection.locale) ?? "en-US",
    source: {
      kind: "web_form",
      provider: inspection.provider,
      responderOrigin: `${inspection.source.origin}/`,
      urlFingerprint: inspection.source.urlFingerprint,
      revision: {
        fingerprint: revisionFingerprint,
        observedAt,
        providerRevision: null,
        questionCount: fields.length,
        pageCount: 1
      }
    },
    prefillFields: [],
    sections,
    flow: {
      entryPageId: pageId,
      coverage,
      pages: [{
        id: pageId,
        ordinal: 1,
        title: sections[0]?.title ?? null,
        sectionIds: sections.map((section) => section.id),
        fieldIds: fields.map((field) => field.id)
      }],
      edges: [flowEdge]
    }
  });
  const blockedFieldIds = fields
    .filter((field) => field.support.status === "unsupported")
    .map((field) => field.id);
  const warnings = [...inspection.warnings];
  if (coverage === "current_page_only") {
    warnings.push(
      "This provider exposes another page. VocaForm prepared the inspected questions and will use a guided manual hand-off for the rest."
    );
  }
  if (blockedFieldIds.length > 0) {
    warnings.push(
      `${blockedFieldIds.length} ${blockedFieldIds.length === 1 ? "question needs" : "questions need"} guided manual handling.`
    );
  }

  return { form, blockedFieldIds, warnings: [...new Set(warnings)] };
}

function compileQuestion(question: WebFormQuestion, id: string, pageId: string): WebFormField {
  const sourceType = question.type;
  const type = sourceType === "unknown" ? "unsupported" : sourceType;
  const providerFieldId = question.providerFieldId
    ?? `unresolved_${fingerprint({ ordinal: question.ordinal, label: question.label }).slice(0, 16)}`;
  const stableLocators = question.locatorCandidates.filter(
    (candidate) => candidate.stability === "high" || candidate.stability === "medium"
  );
  const unsupportedReason = supportBlocker(question, stableLocators.length > 0);
  const supported = unsupportedReason === null;
  const validation = validationForQuestion(question);
  const memory = memoryDescriptor(question);

  return {
    id,
    label: question.label || `Question ${question.ordinal}`,
    type,
    required: question.required,
    interviewPrompt: interviewPrompt(question),
    examples: [],
    options: question.options,
    dependencies: [],
    validation,
    memoryKey: memory?.key ?? null,
    memoryCandidateReason: memory?.reason ?? null,
    sensitivity: sourceType === "file_upload" ? "sensitive" : "standard",
    evidence: [{
      kind: "field",
      text: question.label || `Question ${question.ordinal}`,
      page: 1,
      confidence: question.label ? 1 : 0.5
    }],
    pageId,
    providerFieldId,
    sourceControlType: sourceType,
    matrixRows: [],
    matrixColumns: [],
    support: supported
      ? { status: "supported", reason: null }
      : { status: "unsupported", reason: unsupportedReason },
    deliveryTargets: supported ? [{
      kind: "web_control",
      providerFieldId,
      locatorCandidates: stableLocators,
      confidence: stableLocators.some((candidate) => candidate.stability === "high") ? 1 : 0.85
    }] : [],
    deliveryFallback: supported ? "guided_manual" : "blocked"
  };
}

function supportBlocker(question: WebFormQuestion, hasStableLocator: boolean): string | null {
  if (!question.label) {
    return "The provider did not expose a question label, so VocaForm will not invent one.";
  }
  if (question.type === "file_upload") {
    return "File uploads require provider authentication and explicit file-transfer consent, which are out of scope for this interview.";
  }
  if (question.type === "unknown") {
    return "The provider control type was not recognized, so VocaForm will not guess how it behaves.";
  }
  if (question.type === "matrix" || question.type === "ranking") {
    return `This ${question.type.replace("_", " ")} control needs guided manual handling in the public-form MVP.`;
  }
  if (!supportsDeterministicWebFormInterview(question.type)) {
    return `This ${question.type.replace("_", " ")} control is not supported by the public-form interview.`;
  }
  if ((question.type === "single_choice" || question.type === "multi_choice")
    && question.options.length === 0) {
    return "The provider did not expose the available choices, so VocaForm will not invent them.";
  }
  if ((question.type === "scale" || question.type === "rating")
    && !question.options.some((option) => Number.isFinite(Number(option.replace(",", "."))))) {
    return "The provider did not expose a numeric scale, so VocaForm will not invent its limits.";
  }
  if (!question.providerFieldId) {
    return "The provider did not expose a stable question identifier.";
  }
  if (!hasStableLocator) {
    return "The provider did not expose a stable control locator for this question.";
  }
  return null;
}

function validationForQuestion(question: WebFormQuestion): ValidationConstraint {
  const numericOptions = question.options
    .map((option) => Number(option.replace(",", ".")))
    .filter((value) => Number.isFinite(value));
  return {
    minLength: null,
    maxLength: null,
    minValue: numericOptions.length > 0 ? Math.min(...numericOptions) : null,
    maxValue: numericOptions.length > 0 ? Math.max(...numericOptions) : null,
    pattern: null,
    allowedValues: question.options
  };
}

function memoryDescriptor(question: WebFormQuestion): { key: string; reason: string } | null {
  if (question.type === "email") {
    return { key: "contact.email", reason: "An email address is a stable contact detail you may choose to reuse." };
  }
  if (question.type === "phone") {
    return { key: "contact.phone", reason: "A phone number is a stable contact detail you may choose to reuse." };
  }
  if (question.type === "short_text" && /\b(full|your|contact)?\s*name\b/i.test(question.label)) {
    return { key: "contact.full_name", reason: "A full name is a stable contact detail you may choose to reuse." };
  }
  return null;
}

function interviewPrompt(question: WebFormQuestion): string {
  const description = question.description ? ` ${question.description}` : "";
  if (question.type === "single_choice") {
    return `${question.label}${description} Choose one of: ${question.options.join(", ")}.`;
  }
  if (question.type === "multi_choice") {
    return `${question.label}${description} Choose any that apply: ${question.options.join(", ")}.`;
  }
  return `${question.label}${description}`;
}

function uniqueFieldIds(questions: WebFormQuestion[]): string[] {
  const used = new Set<string>();
  return questions.map((question) => {
    const source = question.providerFieldId ?? `question_${question.ordinal}`;
    const base = `field_${slug(source)}`.slice(0, 72);
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base.slice(0, 66)}_${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return id;
  });
}

function groupSections(fields: WebFormField[], questions: WebFormQuestion[]) {
  const groups = new Map<string, WebFormField[]>();
  for (let index = 0; index < fields.length; index += 1) {
    const title = questions[index]?.sectionTitle || "Form questions";
    const group = groups.get(title) ?? [];
    group.push(fields[index] as WebFormField);
    groups.set(title, group);
  }
  const used = new Set<string>();
  return [...groups.entries()].map(([title, sectionFields], index) => {
    const base = `section_${slug(title) || index + 1}`.slice(0, 72);
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base.slice(0, 66)}_${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return { id, title, fields: sectionFields };
  });
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "question";
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
