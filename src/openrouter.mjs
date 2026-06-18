const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function requestStructuredJson({ config, system, user, jsonSchema, temperature = 0.2 }) {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.referer,
      "X-OpenRouter-Title": config.title
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: jsonSchema.name,
          strict: true,
          schema: jsonSchema.schema
        }
      },
      provider: {
        require_parameters: true,
        data_collection: config.dataCollection
      }
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload ? JSON.stringify(payload) : response.statusText;
    throw new Error(`OpenRouter request failed (${response.status}): ${detail}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter response did not contain message.content.");
  }

  return {
    data: JSON.parse(content),
    raw: payload
  };
}

