import { z } from "zod";
import { semanticVerificationOutputSchema, type FormSession } from "../domain/schemas";
import { verifySession } from "../domain/session";
import type { AppConfig } from "./config";

export const FINAL_VERIFIER_PROMPT = `You are the VocaForm Final Verifier. Review saved form answers without changing, rewriting, or filling any value.

Scope:
- Find semantic contradictions between answered fields or between an answer and an explicit form condition.
- Find ambiguous answers that are too vague to place on the named field reliably.
- Find unsupported claims where the normalized value materially adds certainty or facts absent from the user's exact wording or confirmed memory.
- Use only the supplied form schema, source quotes, answer values, raw wording, provenance, and deterministic-check summary.
- Do not repeat missing-required, type, format, confidence, renderer, or provenance findings already listed by deterministic checks.
- Do not infer medical, legal, identity, family, or consent facts.
- A surprising answer is not a contradiction unless the supplied evidence conflicts.
- Return no finding when the answer is adequately grounded.

Actions:
- Use confirm when the existing wording may be intentional.
- Use correct when a saved value should be changed.
- Use answer only for a genuinely unanswered field.
- Use leave_blank only for an optional field.
- Keep every message concise, calm, and directly actionable.

Return only the strict structured result.`;

export function buildFinalVerifierRequest(
  session: FormSession,
  config: AppConfig,
  mode: "standard" | "pro" = config.openAiVerificationReasoningMode
): Record<string, unknown> {
  const deterministic = verifySession(session);
  const formFields = session.form.sections.flatMap((section) => section.fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    dependencies: field.dependencies,
    options: field.options,
    evidence: field.evidence.map((item) => item.text)
  })));
  const answers = [
    ...Object.values(session.answers),
    ...Object.values(session.prefillAnswers)
  ].filter((answer) => answer.status !== "unanswered").map((answer) => ({
    fieldId: answer.fieldId,
    status: answer.status,
    value: answer.value,
    rawAnswer: answer.rawAnswer,
    normalizedAnswer: answer.normalizedAnswer,
    confidence: answer.confidence,
    source: answer.source,
    memoryClaimId: answer.memoryClaimId
  }));
  const input = {
    form: {
      id: session.form.id,
      title: session.form.title,
      locale: session.form.locale,
      fields: formFields
    },
    answers,
    deterministicFindings: deterministic.issues.map((issue) => ({
      fieldId: issue.fieldId,
      kind: issue.kind,
      message: issue.message
    }))
  };

  return {
    model: config.openAiVerificationModel,
    instructions: FINAL_VERIFIER_PROMPT,
    input: [{
      role: "user" as const,
      content: [{
        type: "input_text" as const,
        text: `Verify this VocaForm session. Do not alter it.\n${JSON.stringify(input)}`
      }]
    }],
    max_output_tokens: 5_000,
    reasoning: { mode, effort: config.openAiReasoningEffort },
    safety_identifier: config.openAiSafetyIdentifier || undefined,
    store: false,
    prompt_cache_key: "vocaform-final-verifier-v1",
    text: {
      format: {
        type: "json_schema",
        name: "vocaform_final_verification",
        strict: true,
        schema: z.toJSONSchema(semanticVerificationOutputSchema)
      }
    }
  };
}
