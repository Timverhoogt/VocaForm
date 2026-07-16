import { describe, expect, it } from "vitest";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import { createFormSession } from "../domain/session";
import { getConfig } from "./config";
import { buildRealtimeInstructions, buildRealtimeSessionConfig } from "./realtime_session";

describe("Realtime session configuration", () => {
  it("uses WebRTC-friendly VAD, server tools, and the explicit realtime model", async () => {
    const form = (await loadGoldenCompilerFixtures())[2]!.form;
    const session = createFormSession(form);
    const config = getConfig({
      OPENAI_REALTIME_MODEL: "gpt-realtime-2.1",
      OPENAI_REALTIME_VOICE: "marin",
      OPENAI_REALTIME_REASONING_EFFORT: "low"
    });
    const realtime = buildRealtimeSessionConfig(session, config) as {
      model: string;
      tools: Array<{ name: string }>;
      audio: { input: { turn_detection: Record<string, unknown>; transcription: { language?: string } } };
    };

    expect(realtime.model).toBe("gpt-realtime-2.1");
    expect(realtime.tools).toHaveLength(8);
    expect(realtime.audio.input.turn_detection).toMatchObject({
      type: "semantic_vad",
      create_response: true,
      interrupt_response: true
    });
    expect(realtime.audio.input.transcription.language).toBe("en");
    expect(buildRealtimeInstructions(session)).toContain("call save_answers before saying the answer was saved");
    expect(buildRealtimeInstructions(session)).toContain("end the response and wait silently");
    expect(buildRealtimeInstructions(session)).toContain("never treat form examples or your own words as user answers");
  });

  it("omits unsupported transcription hints so Realtime can detect the language", async () => {
    const form = structuredClone((await loadGoldenCompilerFixtures())[2]!.form);
    form.locale = "fil-PH";
    const session = createFormSession(form);
    const realtime = buildRealtimeSessionConfig(session, getConfig({})) as {
      audio: { input: { transcription: { language?: string } } };
    };

    expect(realtime.audio.input.transcription.language).toBeUndefined();
    expect(buildRealtimeInstructions(session)).toContain("Default to the form language (fil-PH)");
  });
});
