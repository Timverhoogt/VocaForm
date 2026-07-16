import { describe, expect, it } from "vitest";
import {
  extractFunctionCalls,
  firstResponseDuration,
  realtimeToolRequiresUserTurn,
  RealtimeUserTurnGuard
} from "./realtime";

describe("extractFunctionCalls", () => {
  it("extracts completed calls in response order", () => {
    expect(extractFunctionCalls({
      type: "response.done",
      response: {
        status: "completed",
        output: [
          { type: "message", content: [] },
          { type: "function_call", call_id: "call_1", name: "save_answers", arguments: "{\"answers\":[]}" },
          { type: "function_call", call_id: "call_2", name: "get_remaining_questions", arguments: "{}" }
        ]
      }
    })).toEqual([
      { callId: "call_1", name: "save_answers", arguments: "{\"answers\":[]}" },
      { callId: "call_2", name: "get_remaining_questions", arguments: "{}" }
    ]);
  });

  it("does not expose calls from interrupted responses", () => {
    expect(extractFunctionCalls({
      type: "response.done",
      response: {
        status: "cancelled",
        output: [{ type: "function_call", call_id: "unsafe", name: "save_answers", arguments: "{}" }]
      }
    })).toEqual([]);
  });

  it("records first-response latency as a non-negative rounded duration", () => {
    expect(firstResponseDuration(100.4, 145.8)).toBe(45);
    expect(firstResponseDuration(20, 12)).toBe(0);
  });
});

describe("RealtimeUserTurnGuard", () => {
  it("blocks answer writes until a complete speech turn is observed", () => {
    const guard = new RealtimeUserTurnGuard();

    expect(guard.tryConsumeForTool("save_answers")).toBe(false);
    guard.speechStopped();
    expect(guard.tryConsumeForTool("save_answers")).toBe(false);
    guard.speechStarted();
    expect(guard.tryConsumeForTool("save_answers")).toBe(false);
    guard.speechStopped();
    expect(guard.tryConsumeForTool("save_answers")).toBe(true);
  });

  it("consumes one completed user turn after one write", () => {
    const guard = new RealtimeUserTurnGuard();
    guard.speechStarted();
    guard.speechStopped();

    expect(guard.tryConsumeForTool("mark_unknown_or_skipped")).toBe(true);
    expect(guard.tryConsumeForTool("save_answers")).toBe(false);
  });

  it("allows read-only and completion tools without consuming a user turn", () => {
    const guard = new RealtimeUserTurnGuard();

    expect(guard.tryConsumeForTool("get_interview_context")).toBe(true);
    expect(guard.tryConsumeForTool("get_remaining_questions")).toBe(true);
    expect(guard.tryConsumeForTool("finish_interview")).toBe(true);
  });

  it("resets pending permission on reconnect", () => {
    const guard = new RealtimeUserTurnGuard();
    guard.speechStarted();
    guard.speechStopped();
    guard.reset();

    expect(guard.tryConsumeForTool("remember_answer")).toBe(false);
  });

  it("requires a user turn for every answer-bearing mutation", () => {
    expect([
      "save_answers",
      "mark_unknown_or_skipped",
      "remember_answer",
      "confirm_memory_claim"
    ].every(realtimeToolRequiresUserTurn)).toBe(true);
    expect(realtimeToolRequiresUserTurn("request_memory_confirmation")).toBe(false);
  });
});
