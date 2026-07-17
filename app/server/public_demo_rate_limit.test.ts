import { describe, expect, it } from "vitest";
import { PublicDemoRateLimiter } from "./public_demo_rate_limit";

describe("public demo model request limits", () => {
  it("bounds expensive compilation per visitor", () => {
    const limiter = new PublicDemoRateLimiter();
    expect(limiter.consume("compile", "visitor-a", "address-a", 1).allowed).toBe(true);
    expect(limiter.consume("compile", "visitor-a", "address-a", 2).allowed).toBe(true);
    expect(limiter.consume("compile", "visitor-a", "address-a", 3).allowed).toBe(true);
    const blocked = limiter.consume("compile", "visitor-a", "address-a", 4);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("also bounds cookie churn from one network address", () => {
    const limiter = new PublicDemoRateLimiter();
    for (let index = 0; index < 12; index += 1) {
      expect(limiter.consume("compile", `visitor-${index}`, "one-address", index).allowed).toBe(true);
    }
    expect(limiter.consume("compile", "visitor-13", "one-address", 13).allowed).toBe(false);
  });

  it("opens a fresh window after the previous window expires", () => {
    const limiter = new PublicDemoRateLimiter();
    for (let index = 0; index < 3; index += 1) {
      limiter.consume("compile", "visitor-a", "address-a", index);
    }
    expect(limiter.consume("compile", "visitor-a", "address-a", 60 * 60 * 1_000 + 1).allowed).toBe(true);
  });

  it("bounds read-only provider inspection separately from model compilation", () => {
    const limiter = new PublicDemoRateLimiter();
    for (let index = 0; index < 10; index += 1) {
      expect(limiter.consume("inspect", "visitor-a", "address-a", index).allowed).toBe(true);
    }
    expect(limiter.consume("inspect", "visitor-a", "address-a", 11).allowed).toBe(false);
    expect(limiter.consume("compile", "visitor-a", "address-a", 12).allowed).toBe(true);
  });

  it("bounds browser preparation and submission independently", () => {
    const limiter = new PublicDemoRateLimiter();
    for (let index = 0; index < 6; index += 1) {
      expect(limiter.consume("prepare", "visitor-a", "address-a", index).allowed).toBe(true);
      expect(limiter.consume("submit", "visitor-a", "address-a", index).allowed).toBe(true);
    }
    expect(limiter.consume("prepare", "visitor-a", "address-a", 7).allowed).toBe(false);
    expect(limiter.consume("submit", "visitor-a", "address-a", 7).allowed).toBe(false);
  });
});
