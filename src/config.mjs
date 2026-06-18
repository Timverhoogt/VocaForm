export function getConfig(env = process.env) {
  return {
    openRouterApiKey: env.OPENROUTER_API_KEY || "",
    openRouterModel: env.OPENROUTER_MODEL || "minimax/minimax-m3",
    openRouterStructuredModel: env.OPENROUTER_STRUCTURED_MODEL || "minimax/minimax-m3",
    referer: env.OPENROUTER_REFERER || "http://localhost",
    title: env.OPENROUTER_TITLE || "Voice Form Filler",
    dataCollection: env.OPENROUTER_DATA_COLLECTION || "deny",
    openAiApiKey: env.OPENAI_API_KEY || "",
    openAiRealtimeModel: env.OPENAI_REALTIME_MODEL || "gpt-realtime-2",
    openAiRealtimeVoice: env.OPENAI_REALTIME_VOICE || "marin",
    openAiRealtimeSpeed: Number(env.OPENAI_REALTIME_SPEED || 0.95),
    openAiRealtimeReasoningEffort: env.OPENAI_REALTIME_REASONING_EFFORT || "low",
    openAiRealtimeTranscriptionModel: env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    openAiRealtimeLanguage: env.OPENAI_REALTIME_LANGUAGE || "nl",
    openAiSafetyIdentifier: env.OPENAI_SAFETY_IDENTIFIER || ""
  };
}
