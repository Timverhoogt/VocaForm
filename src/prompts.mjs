export const answerRecordJsonSchema = {
  name: "answer_record",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      field_id: {
        type: "string",
        description: "The exact field id being answered."
      },
      status: {
        type: "string",
        enum: ["answered", "needs_followup", "skipped"],
        description: "Whether the answer is sufficient, needs one follow-up, or was explicitly skipped."
      },
      raw_answer: {
        type: "string",
        description: "The user's answer, lightly cleaned but not rewritten."
      },
      normalized_answer: {
        type: "string",
        description: "Polished Dutch text suitable for the school form. Empty only when skipped."
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence that the normalized answer captures the user intent."
      },
      follow_up_question: {
        type: ["string", "null"],
        description: "A concise Dutch follow-up question if needed; otherwise null."
      }
    },
    required: [
      "field_id",
      "status",
      "raw_answer",
      "normalized_answer",
      "confidence",
      "follow_up_question"
    ]
  }
};

export function buildAnswerNormalizerSystemPrompt() {
  return [
    "You normalize parent interview answers for Dutch school intake forms.",
    "Preserve the parent's meaning and uncertainty.",
    "Do not invent facts.",
    "Write normalized answers in warm, factual Dutch.",
    "If the answer is too vague for the field, set status to needs_followup and ask exactly one short follow-up question.",
    "If the parent explicitly skips the question, set status to skipped."
  ].join(" ");
}

export function buildAnswerNormalizerUserPrompt({ field, transcript }) {
  return JSON.stringify(
    {
      task: "Normalize this answer for one form field.",
      field: {
        id: field.id,
        section: field.section_title,
        label: field.label,
        type: field.type,
        required: field.required,
        interview_prompt: field.interview_prompt,
        examples: field.examples || []
      },
      transcript
    },
    null,
    2
  );
}

export function buildQuestionForField(field) {
  const examples = field.examples?.length ? ` Bijvoorbeeld: ${field.examples.join("; ")}.` : "";
  return `${field.interview_prompt}${examples}`;
}

