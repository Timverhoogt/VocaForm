import "../../src/load_env.mjs";
import path from "node:path";

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

export interface AppConfig {
  host: string;
  port: number;
  publicDemo: boolean;
  storageMode: "local" | "ephemeral";
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
  webFormNativePreparation: boolean;
  webFormInspectionTimeoutMs: number;
  webFormActionTimeoutMs: number;
  webFormSessionTtlMs: number;
  webFormMaxConcurrentSessions: number;
  webFormMaxRequests: number;
  workDir: string;
  sofficeBin: string;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: parsePort(env.PORT, 5177),
    publicDemo: parseBoolean(env.VOCAFORM_PUBLIC_DEMO),
    storageMode: parseStorageMode(env.VOCAFORM_STORAGE_MODE),
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
    webFormNativePreparation: !parseDisabled(env.VOCAFORM_WEBFORM_NATIVE_PREPARATION),
    webFormInspectionTimeoutMs: parseBoundedInteger(
      env.VOCAFORM_WEBFORM_INSPECTION_TIMEOUT_MS,
      30_000,
      5_000,
      60_000
    ),
    webFormActionTimeoutMs: parseBoundedInteger(
      env.VOCAFORM_WEBFORM_ACTION_TIMEOUT_MS,
      10_000,
      2_000,
      30_000
    ),
    webFormSessionTtlMs: parseBoundedInteger(
      env.VOCAFORM_WEBFORM_SESSION_TTL_MS,
      15 * 60 * 1_000,
      60_000,
      30 * 60 * 1_000
    ),
    webFormMaxConcurrentSessions: parseBoundedInteger(
      env.VOCAFORM_WEBFORM_MAX_CONCURRENT_SESSIONS,
      parseBoolean(env.VOCAFORM_PUBLIC_DEMO) ? 2 : 4,
      1,
      8
    ),
    webFormMaxRequests: parseBoundedInteger(
      env.VOCAFORM_WEBFORM_MAX_REQUESTS,
      300,
      50,
      1_000
    ),
    workDir: path.resolve(env.VOCAFORM_WORK_DIR?.trim() || "work"),
    sofficeBin: env.SOFFICE_BIN?.trim() || "soffice"
  };
}

function parseDisabled(value: string | undefined): boolean {
  return ["0", "false", "no", "off", "disabled"].includes(value?.trim().toLowerCase() || "");
}

function parseBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
}

function parseStorageMode(value: string | undefined): AppConfig["storageMode"] {
  return value?.trim().toLowerCase() === "ephemeral" ? "ephemeral" : "local";
}

function parseRealtimeReasoningEffort(value: string | undefined): AppConfig["openAiRealtimeReasoningEffort"] {
  if (value === "medium" || value === "high") return value;
  return "low";
}

function parseNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function parseReasoningEffort(value: string | undefined): AppConfig["openAiReasoningEffort"] {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max") {
    return value;
  }
  return "high";
}
