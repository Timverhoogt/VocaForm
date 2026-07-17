import { describe, expect, it, vi } from "vitest";
import { createFormSession, saveTextAnswer } from "../domain/session";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import type { AppConfig } from "./config";
import { OpenAiFinalVerifier } from "./final_verifier";
import { buildFinalVerifierRequest } from "./final_verifier_request";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 5177,
  publicDemo: false,
  storageMode: "local",
  openAiApiKey: "test-key",
  openAiModel: "gpt-5.6-sol",
  openAiReasoningEffort: "high",
  openAiVerificationModel: "gpt-5.6-sol",
  openAiVerificationReasoningMode: "standard",
  openAiRealtimeModel: "gpt-realtime-2.1",
  openAiRealtimeVoice: "marin",
  openAiRealtimeSpeed: 0.95,
  openAiRealtimeReasoningEffort: "low",
  openAiRealtimeTranscriptionModel: "gpt-4o-mini-transcribe",
  openAiRealtimeLanguage: "",
  openAiSafetyIdentifier: "synthetic-test",
  webFormNativePreparation: true,
  webFormInspectionTimeoutMs: 30_000,
  webFormActionTimeoutMs: 10_000,
  webFormSessionTtlMs: 900_000,
  webFormMaxConcurrentSessions: 4,
  webFormMaxRequests: 300,
  workDir: "work",
  sofficeBin: "soffice"
};

describe("OpenAI final verifier", () => {
  it("uses Sol, high effort, explicit reasoning mode, strict output, and no storage", async () => {
    const session = await activitySession();
    const request = buildFinalVerifierRequest(session, config, "pro");

    expect(request).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "high", mode: "pro" },
      safety_identifier: "synthetic-test",
      store: false,
      prompt_cache_key: "vocaform-final-verifier-v1"
    });
    const text = request.text as { format: { type: string; strict: boolean; schema: unknown } };
    expect(text.format).toMatchObject({ type: "json_schema", strict: true });
    expectStrictObjectSchemas(text.format.schema);
  });

  it("parses findings while leaving the supplied session byte-for-byte unchanged", async () => {
    const session = saveTextAnswer(await activitySession(), "child_name", "Mila Hart");
    const serializedBefore = JSON.stringify(session);
    const responseFactory = vi.fn(() => Promise.resolve({
      id: "resp_verifier_test",
      output_text: JSON.stringify({
        findings: [{
          kind: "ambiguous_answer",
          severity: "blocker",
          fieldIds: ["child_name"],
          message: "Confirm the full name.",
          evidence: "Only one name was supplied.",
          actions: ["confirm", "correct"]
        }]
      }),
      output: [],
      usage: { input_tokens: 120, output_tokens: 30 }
    }));
    const verifier = new OpenAiFinalVerifier(config, responseFactory);

    const result = await verifier.verify(session);

    expect(result).toMatchObject({
      responseId: "resp_verifier_test",
      inputTokens: 120,
      outputTokens: 30,
      output: { findings: [expect.objectContaining({ kind: "ambiguous_answer" })] }
    });
    expect(JSON.stringify(session)).toBe(serializedBefore);
    expect(responseFactory).toHaveBeenCalledOnce();
  });

  it("surfaces verifier refusals without producing a result", async () => {
    const verifier = new OpenAiFinalVerifier(config, () => Promise.resolve({
      id: "resp_refusal",
      output_text: "",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot verify." }] }]
    }));

    await expect(verifier.verify(await activitySession())).rejects.toThrow("Cannot verify.");
  });
});

async function activitySession() {
  const form = (await loadGoldenCompilerFixtures())
    .find((fixture) => fixture.id === "activity-permission-conditional")!.form;
  return createFormSession(form, new Date("2026-07-14T12:00:00.000Z"));
}

function expectStrictObjectSchemas(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectStrictObjectSchemas);
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "object" && isRecord(value.properties)) {
    expect(value.additionalProperties).toBe(false);
    expect(new Set(value.required as string[])).toEqual(new Set(Object.keys(value.properties)));
  }
  Object.values(value).forEach(expectStrictObjectSchemas);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
