import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  elapsedMilliseconds,
  normalizeInterviewToolTraceName,
  ResilienceTracer,
  type ResilienceTraceRecord
} from "./resilience_trace";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("privacy-safe resilience traces", () => {
  it("writes only the bounded metric contract to a private local NDJSON file", () => {
    const directory = temporaryDirectory();
    const tracer = new ResilienceTracer(directory);

    expect(tracer.record({
      event: "compiler",
      outcome: "success",
      durationMs: 812,
      inputTokens: 1_200,
      outputTokens: 340
    }, new Date("2026-07-15T08:00:00.000Z"))).toBe(true);

    const record = JSON.parse(readFileSync(tracer.filePath, "utf8")) as ResilienceTraceRecord;
    expect(record).toEqual({
      schemaVersion: 1,
      at: "2026-07-15T08:00:00.000Z",
      event: "compiler",
      outcome: "success",
      durationMs: 812,
      inputTokens: 1_200,
      outputTokens: 340,
      tool: null,
      cached: null,
      renderKind: null,
      coveragePercent: null,
      fallbackCount: null
    });
    expect(statSync(tracer.filePath).mode & 0o777).toBe(0o600);
  });

  it("rejects unexpected content instead of recording form or answer data", () => {
    const directory = temporaryDirectory();
    const tracer = new ResilienceTracer(directory);

    expect(tracer.record({
      event: "interview_tool",
      outcome: "success",
      durationMs: 4,
      tool: "save_answers",
      answer: "This must never reach a trace."
    })).toBe(false);
    expect(() => readFileSync(tracer.filePath)).toThrow();
  });

  it("normalizes unknown tool names and rounds monotonic durations", () => {
    expect(normalizeInterviewToolTraceName("save_answers")).toBe("save_answers");
    expect(normalizeInterviewToolTraceName("invented_tool")).toBe("unknown");
    expect(elapsedMilliseconds(100.4, 112.7)).toBe(12);
    expect(elapsedMilliseconds(12, 8)).toBe(0);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "vocaform-resilience-"));
  temporaryDirectories.push(directory);
  return directory;
}
