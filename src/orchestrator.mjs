import { getAllInterviewFields, listOpenFields, reviewSession } from "./form_state.mjs";
import {
  buildInterviewControlReply,
  cleanTranscriptText,
  isInterviewControlOnly
} from "./transcript_cleanup.mjs";

export const interviewOrchestratorDecisionJsonSchema = {
  name: "interview_orchestration_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: [
          "extract_answers",
          "ask_followup",
          "ask_next_field",
          "review_before_export",
          "block_final_export"
        ],
        description: "The single next action the application should take."
      },
      target_field_id: {
        type: ["string", "null"],
        description: "An open field id to focus next, or null when the action is not field-specific."
      },
      user_message: {
        type: "string",
        description: "Short Dutch message for the user or realtime interviewer."
      },
      rationale: {
        type: "string",
        description: "Brief implementation-facing reason for this action."
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence that this action is the right next step."
      },
      should_clear_transcript: {
        type: "boolean",
        description: "Whether the browser can clear the whole-form transcript draft after this action completes."
      }
    },
    required: [
      "action",
      "target_field_id",
      "user_message",
      "rationale",
      "confidence",
      "should_clear_transcript"
    ]
  }
};

function truncateText(value, maxLength = 16000) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n[Transcript truncated for orchestration decision]`;
}

function fieldSummary(field, state) {
  const answer = state.interview_answers?.[field.id] || {};
  return {
    id: field.id,
    section: field.section_title,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    interview_prompt: field.interview_prompt,
    status: answer.status || "unanswered",
    follow_up_question: answer.follow_up_question || null,
    examples: field.examples || []
  };
}

function reviewSummary(review) {
  return {
    ready_for_final_export: Boolean(review.ready_for_final_export),
    counts: review.counts,
    blockers: review.blockers.map((item) => ({
      field_id: item.field_id,
      kind: item.kind,
      label: item.label,
      message: item.message,
      follow_up_question: item.follow_up_question || null
    })),
    warnings: review.warnings.map((item) => ({
      field_id: item.field_id,
      kind: item.kind,
      label: item.label,
      message: item.message
    }))
  };
}

export function buildInterviewOrchestratorSystemPrompt() {
  return [
    "You are the narrow VocaForm form-interview orchestrator.",
    "Your job is to choose one next workflow action for a whole-form interview.",
    "You do not write session state, do not export files, and do not invent answers.",
    "The application owns all deterministic tools: transcript extraction, answer recording, review, and export.",
    "The transcript may contain speech-to-text spacing or casing artifacts; mentally repair obvious Dutch phrases, for example Geefsvoorbeelden means geef wat voorbeelden.",
    "Treat standalone interview-control requests such as geef wat voorbeelden, herhaal de vraag, or wat bedoel je as requests for help, not as form answers.",
    "Choose extract_answers when the transcript contains any possible field answers or explicit skips.",
    "Choose ask_followup when the transcript only asks for examples, clarification, or a repeated question.",
    "Choose ask_followup when the transcript is too vague and one field clearly needs clarification before extraction.",
    "Choose ask_next_field when there is no useful transcript yet and the interview should continue.",
    "Choose review_before_export only when all open work appears finished and the deterministic review should be shown.",
    "Choose block_final_export when the user is trying to finish but review blockers remain.",
    "Use only field ids from the provided open_fields list for target_field_id.",
    "Keep user_message short, Dutch, calm, and operational."
  ].join(" ");
}

export function buildInterviewOrchestratorUserPrompt({ formSchema, state, transcript, requestedAction = "process_transcript" }) {
  const review = reviewSession(formSchema, state);
  const openFields = listOpenFields(formSchema, state);
  const allFields = getAllInterviewFields(formSchema);
  const cleanedTranscript = cleanTranscriptText(transcript);

  return JSON.stringify(
    {
      task: "Choose the next whole-form interview workflow action.",
      requested_action: requestedAction,
      form: {
        id: formSchema.form_id,
        title: formSchema.title,
        language: formSchema.language,
        total_interview_fields: allFields.length
      },
      review: reviewSummary(review),
      open_fields: openFields.map((field) => fieldSummary(field, state)),
      transcript: truncateText(cleanedTranscript),
      raw_transcript_changed_by_local_cleanup: cleanedTranscript !== String(transcript || "").trim()
    },
    null,
    2
  );
}

function clampConfidence(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

export function buildRuleBasedInterviewDecision({ formSchema, state, transcript, requestedAction = "process_transcript" }) {
  const review = reviewSession(formSchema, state);
  const openFields = listOpenFields(formSchema, state);
  const cleanedTranscript = cleanTranscriptText(transcript);
  const hasTranscript = Boolean(cleanedTranscript);

  if (hasTranscript && openFields.length && isInterviewControlOnly(cleanedTranscript)) {
    const targetField = openFields[0];
    return {
      action: "ask_followup",
      target_field_id: targetField.id,
      user_message: buildInterviewControlReply(cleanedTranscript, targetField),
      rationale: "Transcript only contains an interview-control request, not a field answer.",
      confidence: 0.85,
      should_clear_transcript: true
    };
  }

  if (hasTranscript && openFields.length) {
    return {
      action: "extract_answers",
      target_field_id: null,
      user_message: "Ik verwerk het transcript en werk de besproken velden bij.",
      rationale: "Transcript text is present and there are open fields.",
      confidence: 0.7,
      should_clear_transcript: true
    };
  }

  if (!openFields.length && review.ready_for_final_export) {
    return {
      action: "review_before_export",
      target_field_id: null,
      user_message: "Alle velden zijn verwerkt. Controleer de review en maak daarna de finale export.",
      rationale: "No open fields remain and deterministic review is final-ready.",
      confidence: 0.9,
      should_clear_transcript: hasTranscript
    };
  }

  if (requestedAction === "final_export" && !review.ready_for_final_export) {
    return {
      action: "block_final_export",
      target_field_id: review.blockers[0]?.field_id || openFields[0]?.id || null,
      user_message: "De finale export is nog geblokkeerd. Los eerst de open reviewpunten op.",
      rationale: "Final export was requested while review blockers remain.",
      confidence: 0.9,
      should_clear_transcript: false
    };
  }

  return {
    action: "ask_next_field",
    target_field_id: openFields[0]?.id || null,
    user_message: openFields[0]
      ? openFields[0].interview_prompt
      : "Controleer de review om te zien wat er nog nodig is.",
    rationale: "No useful transcript was provided for extraction.",
    confidence: 0.75,
    should_clear_transcript: false
  };
}

export function normalizeInterviewOrchestratorDecision(decision, { formSchema, state, transcript, requestedAction }) {
  const fallback = buildRuleBasedInterviewDecision({ formSchema, state, transcript, requestedAction });
  const openFieldIds = new Set(listOpenFields(formSchema, state).map((field) => field.id));
  const validActions = new Set(interviewOrchestratorDecisionJsonSchema.schema.properties.action.enum);
  const controlOnly = isInterviewControlOnly(transcript);
  const action = controlOnly
    ? fallback.action
    : validActions.has(decision?.action) ? decision.action : fallback.action;
  const targetFieldId = controlOnly
    ? fallback.target_field_id
    : openFieldIds.has(decision?.target_field_id) ? decision.target_field_id : null;
  const userMessage = String(
    (controlOnly ? fallback.user_message : decision?.user_message) || fallback.user_message
  ).trim() || fallback.user_message;
  const rationale = String(
    (controlOnly ? fallback.rationale : decision?.rationale) || fallback.rationale
  ).trim() || fallback.rationale;
  const hasClearDecision = typeof decision?.should_clear_transcript === "boolean";
  const shouldClearTranscript = action === "extract_answers"
    ? true
    : controlOnly ? true
    : hasClearDecision ? decision.should_clear_transcript : fallback.should_clear_transcript;

  return {
    action,
    target_field_id: targetFieldId,
    user_message: userMessage,
    rationale,
    confidence: controlOnly ? fallback.confidence : clampConfidence(decision?.confidence, fallback.confidence),
    should_clear_transcript: shouldClearTranscript
  };
}

export async function decideInterviewOrchestration({
  config,
  formSchema,
  state,
  transcript,
  requestedAction = "process_transcript",
  useOpenRouter = true,
  requestStructuredJson
}) {
  if (!useOpenRouter || !config.openRouterApiKey) {
    return {
      source: "local_rules",
      model: "local_rules",
      decision: buildRuleBasedInterviewDecision({ formSchema, state, transcript, requestedAction }),
      raw: null
    };
  }

  const result = await requestStructuredJson({
    config,
    system: buildInterviewOrchestratorSystemPrompt(),
    user: buildInterviewOrchestratorUserPrompt({ formSchema, state, transcript, requestedAction }),
    jsonSchema: interviewOrchestratorDecisionJsonSchema,
    temperature: 0
  });

  return {
    source: "openrouter",
    model: result.model,
    decision: normalizeInterviewOrchestratorDecision(result.data, {
      formSchema,
      state,
      transcript,
      requestedAction
    }),
    raw: result.raw
  };
}
