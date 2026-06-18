export function getConfig(env = process.env) {
  return {
    openRouterApiKey: env.OPENROUTER_API_KEY || "",
    openRouterModel: env.OPENROUTER_MODEL || "~openai/gpt-latest",
    referer: env.OPENROUTER_REFERER || "http://localhost",
    title: env.OPENROUTER_TITLE || "Voice Form Filler",
    dataCollection: env.OPENROUTER_DATA_COLLECTION || "deny"
  };
}

