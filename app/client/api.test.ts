import { afterEach, describe, expect, it, vi } from "vitest";
import { reportRealtimeFirstResponse } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client resilience metrics", () => {
  it("reports only a bounded first-response duration and never waits on telemetry", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);

    reportRealtimeFirstResponse(81.6);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/resilience/metric", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "realtime_first_response",
        outcome: "success",
        durationMs: 82
      }),
      keepalive: true
    });
  });
});
