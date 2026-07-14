import type { FormSession } from "../domain/schemas";
import type { AppConfig } from "./config";
import { buildRealtimeToolDefinitions } from "./interview_tools";

export function buildRealtimeSessionConfig(
  session: FormSession,
  config: AppConfig
): Record<string, unknown> {
  const language = config.openAiRealtimeLanguage || session.form.locale.split("-")[0] || "en";
  const realtimeSession: Record<string, unknown> = {
    type: "realtime",
    model: config.openAiRealtimeModel,
    instructions: buildRealtimeInstructions(session),
    output_modalities: ["audio"],
    max_output_tokens: 900,
    tools: buildRealtimeToolDefinitions(),
    tool_choice: "auto",
    audio: {
      input: {
        noise_reduction: { type: "near_field" },
        transcription: {
          model: config.openAiRealtimeTranscriptionModel,
          language,
          prompt: `A calm form interview for “${session.form.title}”. Preserve names, dates, phone numbers, choices, and exact user wording.`
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: true,
          interrupt_response: true
        }
      },
      output: {
        voice: config.openAiRealtimeVoice,
        speed: config.openAiRealtimeSpeed
      }
    }
  };
  if (config.openAiRealtimeModel.includes("realtime-2")) {
    realtimeSession.reasoning = { effort: config.openAiRealtimeReasoningEffort };
  }
  return realtimeSession;
}

export function buildRealtimeInstructions(session: FormSession): string {
  return [
    "You are VocaForm's calm voice interviewer.",
    `Conduct the interview in the user's language; the form locale is ${session.form.locale}.`,
    `The active form is “${session.form.title}”.`,
    "Ask one short question at a time. Sound warm, direct, and unhurried.",
    "At startup or after reconnecting, call get_interview_context before speaking.",
    "If context.memory.suggestions contains remembered facts, briefly name one value and its source form, ask whether to use it here, and call confirm_memory_claim only after an explicit yes. Never apply it silently.",
    "After memory suggestions are handled, ask context.nextQuestion.",
    "After the user answers, call save_answers before saying the answer was saved. Preserve their exact wording in rawAnswer.",
    "A single user utterance may answer multiple related fields; save them atomically in one save_answers call.",
    "Use canonical values: booleans as true/false, numbers as numbers, ISO dates as YYYY-MM-DD, and choices exactly as shown.",
    "Never infer or invent an answer. If the answer is unclear, ask one concise follow-up instead of saving it with high confidence.",
    "If the user explicitly does not know or wants to move on, call mark_unknown_or_skipped.",
    "Use the sessionVersion returned by the latest tool output for the next write. On version_conflict, refresh context and do not repeat an old write.",
    "When context.memory.rememberableAnswers contains a stable contact fact, offer once to remember it. Do not offer for anything absent from that list.",
    "request_memory_confirmation only checks eligibility and never stores. Call remember_answer only after an explicit yes or an explicit request to remember, and preserve the user's confirmation wording.",
    "Model conversation history is never memory. Only facts returned by Memory Vault tools may be described as remembered.",
    "Call finish_interview before claiming the form is complete. If canFinish is false, explain the next needed item and continue.",
    "Do not mention tool names, JSON, field IDs, confidence scores, model names, or internal state to the user.",
    "Keep spoken turns brief. Examples are hints, never facts about the user."
  ].join("\n");
}
