const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

function uniqueModels(models) {
  return [...new Set(models.map((model) => String(model || "").trim()).filter(Boolean))];
}

function isStructuredRoutingError(status, payload) {
  const message = String(payload?.error?.message || "").toLowerCase();
  return status === 404 && message.includes("no endpoints found") && message.includes("requested parameters");
}

async function sendStructuredJsonRequest({ config, model, system, user, jsonSchema, temperature }) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.referer,
      "X-OpenRouter-Title": config.title
    },
    body: JSON.stringify({
      model,
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
  return {
    model,
    response,
    payload
  };
}

export async function requestStructuredJson({ config, system, user, jsonSchema, temperature = 0.2 }) {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const models = uniqueModels([
    config.openRouterModel,
    config.openRouterStructuredModel
  ]);
  let lastFailure = null;

  for (const model of models) {
    const attempt = await sendStructuredJsonRequest({
      config,
      model,
      system,
      user,
      jsonSchema,
      temperature
    });

    if (attempt.response.ok) {
      const content = attempt.payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`OpenRouter response from ${model} did not contain message.content.`);
      }

      return {
        data: JSON.parse(content),
        raw: attempt.payload,
        model
      };
    }

    lastFailure = attempt;
    if (!isStructuredRoutingError(attempt.response.status, attempt.payload)) break;
  }

  const detail = lastFailure?.payload ? JSON.stringify(lastFailure.payload) : lastFailure?.response.statusText;
  throw new Error(`OpenRouter request failed for ${lastFailure?.model} (${lastFailure?.response.status}): ${detail}`);
}
