let client = null;
let clientKey = null;

export async function createOpenAiResponse(apiKey, request) {
  if (!client || clientKey !== apiKey) {
    const { default: OpenAI } = await import("openai");
    client = new OpenAI({ apiKey });
    clientKey = apiKey;
  }
  return client.responses.create(request);
}
