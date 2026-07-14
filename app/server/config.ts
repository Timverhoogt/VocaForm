import "../../src/load_env.mjs";
import path from "node:path";

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

export interface AppConfig {
  host: string;
  port: number;
  openAiApiKey: string;
  openAiModel: string;
  openAiReasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
  openAiVerificationModel: string;
  openAiVerificationReasoningMode: "standard" | "pro";
  openAiRealtimeModel: string;
  openAiRealtimeVoice: string;
  openAiRealtimeSpeed: number;
  openAiRealtimeReasoningEffort: "low" | "medium" | "high";
  openAiRealtimeTranscriptionModel: string;
  openAiRealtimeLanguage: string;
  openAiSafetyIdentifier: string;
  workDir: string;
  sofficeBin: string;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: parsePort(env.PORT, 5177),
    openAiApiKey: env.OPENAI_API_KEY?.trim() || "",
    openAiModel: env.OPENAI_MODEL?.trim() || "gpt-5.6-sol",
    openAiReasoningEffort: parseReasoningEffort(env.OPENAI_REASONING_EFFORT),
    openAiVerificationModel: env.OPENAI_VERIFICATION_MODEL?.trim()
      || env.OPENAI_MODEL?.trim()
      || "gpt-5.6-sol",
    openAiVerificationReasoningMode: env.OPENAI_VERIFICATION_REASONING_MODE === "pro" ? "pro" : "standard",
    openAiRealtimeModel: env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1",
    openAiRealtimeVoice: env.OPENAI_REALTIME_VOICE?.trim() || "marin",
    openAiRealtimeSpeed: parseNumber(env.OPENAI_REALTIME_SPEED, 0.95, 0.25, 1.5),
    openAiRealtimeReasoningEffort: parseRealtimeReasoningEffort(env.OPENAI_REALTIME_REASONING_EFFORT),
    openAiRealtimeTranscriptionModel: env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe",
    openAiRealtimeLanguage: env.OPENAI_REALTIME_LANGUAGE?.trim() || "",
    openAiSafetyIdentifier: env.OPENAI_SAFETY_IDENTIFIER?.trim() || "",
    workDir: path.resolve(env.VOCAFORM_WORK_DIR?.trim() || "work"),
    sofficeBin: env.SOFFICE_BIN?.trim() || "soffice"
  };
}

function parseRealtimeReasoningEffort(value: string | undefined): AppConfig["openAiRealtimeReasoningEffort"] {
  if (value === "medium" || value === "high") return value;
  return "low";
}

function parseNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function parseReasoningEffort(value: string | undefined): AppConfig["openAiReasoningEffort"] {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max") {
    return value;
  }
  return "high";
}
