import { describe, expect, it } from "vitest";
import { extractFunctionCalls } from "./realtime";

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
});
