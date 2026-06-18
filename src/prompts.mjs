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
        description: "Polished Dutch text suitable for the form. Empty only when skipped."
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

const answerRecordSchema = {
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
      description: "The transcript fragment that supports this field record."
    },
    normalized_answer: {
      type: "string",
      description: "Polished Dutch text suitable for the form. Empty only when skipped."
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence that the normalized answer captures the user's intent."
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
};

export const transcriptExtractionJsonSchema = {
  name: "interview_transcript_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answers: {
        type: "array",
        description: "Answer records extracted from the transcript.",
        items: answerRecordSchema
      }
    },
    required: ["answers"]
  }
};

export function buildAnswerNormalizerSystemPrompt() {
  return [
    "You normalize interview answers for Dutch intake, application, medical, school, activity, and other forms.",
    "Preserve the user's meaning and uncertainty.",
    "Do not invent facts.",
    "Write normalized answers in warm, factual Dutch.",
    "If the answer is too vague for the field, set status to needs_followup and ask exactly one short follow-up question.",
    "If the user explicitly skips the question, set status to skipped."
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

export function buildTranscriptExtractorSystemPrompt() {
  return [
    "You extract form answers from a Dutch interview transcript.",
    "Use only facts stated in the transcript. Do not invent or infer new facts.",
    "The user may answer fields out of order or combine multiple fields in one answer.",
    "Return records only for fields that are actually discussed, explicitly skipped, or discussed too vaguely to be usable.",
    "Leave fields out when the transcript contains no relevant information for them.",
    "For a vague answer, set status to needs_followup and ask exactly one short Dutch follow-up question.",
    "For explicit no/none/not applicable answers, set status to answered unless the user clearly wants to skip it.",
    "Write normalized answers in warm, factual Dutch suitable for the form."
  ].join(" ");
}

export function buildTranscriptExtractorUserPrompt({ fields, transcript }) {
  return JSON.stringify(
    {
      task: "Extract reusable answer records from this whole-form interview transcript.",
      fields: fields.map((field) => ({
        id: field.id,
        section: field.section_title,
        label: field.label,
        type: field.type,
        required: field.required,
        interview_prompt: field.interview_prompt,
        examples: field.examples || []
      })),
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
