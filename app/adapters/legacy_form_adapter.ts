import { z } from "zod";
import {
  documentFormDefinitionSchema,
  type DocumentFormDefinition,
  type DocumentFormField,
  type FormDefinition,
} from "../domain/schemas";
import { isDocumentFormDefinition } from "../domain/form_definition";
import { normalizeLocale } from "../domain/locale";

const legacyProfileFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  profile_key: z.string()
});

const legacyFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  render_anchor: z.string().optional(),
  type: z.string(),
  required: z.boolean().default(false),
  interview_prompt: z.string(),
  examples: z.array(z.string()).default([])
});

const legacyFormSchema = z.object({
  form_id: z.string(),
  version: z.string(),
  title: z.string(),
  language: z.string().default("en"),
  source: z.object({
    filename: z.string(),
    format: z.string()
  }),
  profile_fields: z.array(legacyProfileFieldSchema).default([]),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    fields: z.array(legacyFieldSchema)
  }))
});

export function fromLegacyForm(input: unknown): DocumentFormDefinition {
  const legacy = legacyFormSchema.parse(input);

  return documentFormDefinitionSchema.parse({
    id: legacy.form_id,
    version: legacy.version,
    title: legacy.title,
    locale: normalizeLocale(legacy.language),
    source: {
      fileName: legacy.source.filename,
      format: normalizeSourceFormat(legacy.source.format)
    },
    prefillFields: legacy.profile_fields.map((field) => ({
      id: field.id,
      label: field.label,
      memoryKey: field.profile_key
    })),
    sections: legacy.sections.map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.fields.map(toCanonicalField)
    }))
  });
}

export function toLegacyForm(form: FormDefinition): object {
  if (!isDocumentFormDefinition(form)) {
    throw new Error("Web forms cannot be converted to the legacy document schema.");
  }
  return {
    form_id: form.id,
    version: form.version,
    title: form.title,
    language: form.locale,
    source: {
      filename: form.source.fileName,
      format: form.source.format
    },
    profile_fields: form.prefillFields.map((field) => ({
      id: field.id,
      label: field.label,
      profile_key: field.memoryKey
    })),
    sections: form.sections.map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.fields.map((field) => ({
        id: field.id,
        label: field.label,
        render_anchor: field.renderTargets.find((target) => target.kind === "docx_anchor")?.locator,
        type: field.type,
        required: field.required,
        interview_prompt: field.interviewPrompt,
        examples: field.examples
      }))
    }))
  };
}

function toCanonicalField(field: z.infer<typeof legacyFieldSchema>): DocumentFormField {
  const anchor = field.render_anchor?.trim();
  return {
    id: field.id,
    label: field.label,
    type: normalizeFieldType(field.type),
    required: field.required,
    interviewPrompt: field.interview_prompt,
    examples: field.examples,
    options: [],
    dependencies: [],
    validation: {
      minLength: null,
      maxLength: null,
      minValue: null,
      maxValue: null,
      pattern: null,
      allowedValues: []
    },
    memoryKey: null,
    memoryCandidateReason: null,
    sensitivity: "standard",
    evidence: anchor
      ? [{ kind: "text", text: anchor, page: null, confidence: 1 }]
      : [],
    renderTargets: anchor
      ? [{ kind: "docx_anchor", locator: anchor, confidence: 1 }]
      : [{ kind: "answer_packet", locator: field.id, confidence: 1 }],
    renderFallback: "append_answer_packet"
  };
}

function normalizeFieldType(value: string): DocumentFormField["type"] {
  const supported: DocumentFormField["type"][] = [
    "short_text",
    "long_text",
    "email",
    "phone",
    "date",
    "number",
    "boolean",
    "single_choice",
    "multi_choice"
  ];
  return supported.includes(value as DocumentFormField["type"])
    ? value as DocumentFormField["type"]
    : "long_text";
}

function normalizeSourceFormat(value: string): DocumentFormDefinition["source"]["format"] {
  if (value === "docx" || value === "pdf" || value === "text") return value;
  return "fixture";
}
