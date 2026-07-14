import { z } from "zod";
import { formCompilerOutputSchema } from "../domain/schemas";
import type { AppConfig } from "./config";
import type { CompilerInputContent, PreparedCompilerDocument } from "./document_upload";

export const FORM_COMPILER_PROMPT = `You are the VocaForm Form Compiler. Convert the uploaded document into a complete interview-ready form schema.

Grounding rules:
- Detect only fields the user is actually expected to answer. Never invent a plausible field.
- For every field, include a short exact quote from the uploaded document as evidence. Preserve its wording closely enough for deterministic text matching.
- Include a 1-based page number when the page can be identified. Use null only when pages do not exist or cannot be determined.
- Mark required only when the document explicitly indicates it, or when completion is structurally mandatory and visually unambiguous.
- If the document is not a form, set isForm to false and return no sections.

Interview rules:
- Use stable lowercase snake_case IDs that are unique across the entire form.
- Write a gentle, plain-language interviewPrompt that asks one thing at a time.
- Preserve all visible choices. Use dependencies only for genuinely conditional questions and point them to another field ID.
- Translate explicit limits into validation; use null and empty arrays when no limit appears.
- Suggest a memoryKey only for stable, ordinary adult contact facts such as a name, phone number, or email address. A consenting parent or guardian's own contact fields may be candidates on a child form.
- For child identifiers, child-development, household narrative, medical, financial, identity-document, long free-text, sensitive, or restricted fields, return null for both memoryKey and memoryCandidateReason.
- Mark medical, financial, identity, and child-development fields sensitive or restricted.

Rendering rules:
- For DOCX, use an exact nearby label or anchor as a docx_anchor when confident.
- For PDF, use pdf_field only when an actual fillable field name is identifiable. When a verified AcroForm field inventory is supplied, copy its field name exactly as the locator and never invent another name.
- Always provide an answer_packet target when the original cannot be addressed reliably.
- Set renderFallback to append_answer_packet unless the field truly requires manual placement.

Return concise warnings for unreadable, ambiguous, or visually uncertain parts. Do not return prose outside the structured result.`;

export function buildCompilerRequest(
  document: PreparedCompilerDocument,
  config: AppConfig
): Record<string, unknown> {
  const content: CompilerInputContent[] = [
    ...document.content,
    {
      type: "input_text",
      text: `Compile “${document.fileName}”. Treat visual layout, extracted text, and repeated labels as evidence. Return every user-answerable field exactly once.`
    }
  ];

  return {
    model: config.openAiModel,
    instructions: FORM_COMPILER_PROMPT,
    input: [{ role: "user" as const, content }],
    max_output_tokens: 24_000,
    reasoning: { effort: config.openAiReasoningEffort },
    safety_identifier: config.openAiSafetyIdentifier || undefined,
    store: false,
    prompt_cache_key: "vocaform-form-compiler-v1",
    text: {
      format: {
        type: "json_schema",
        name: "vocaform_form_compilation",
        strict: true,
        schema: z.toJSONSchema(formCompilerOutputSchema)
      }
    }
  };
}
