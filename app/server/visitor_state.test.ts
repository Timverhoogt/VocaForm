import { describe, expect, it } from "vitest";
import { createEmptyMemoryVault } from "../domain/memory";
import {
  PUBLIC_VISITOR_TTL_MS,
  publicVisitorCookie,
  VISITOR_COOKIE_NAME,
  VisitorStateRegistry,
  visitorIdFromCookie
} from "./visitor_state";

describe("visitor state isolation", () => {
  it("keeps private local mode on one persistent state", () => {
    const memory = createEmptyMemoryVault();
    const registry = new VisitorStateRegistry({ publicDemo: false, localMemoryVault: memory });

    const first = registry.resolve(null);
    const second = registry.resolve(crypto.randomUUID());

    expect(first.id).toBe("local");
    expect(second.state).toBe(first.state);
    expect(first.state.memoryVault).toBe(memory);
  });

  it("isolates public visitors and never starts them from the local vault", () => {
    const localMemory = createEmptyMemoryVault();
    localMemory.claims.push({} as never);
    const registry = new VisitorStateRegistry({ publicDemo: true, localMemoryVault: localMemory });

    const first = registry.resolve(null, 1_000);
    const repeat = registry.resolve(first.id, 2_000);
    const second = registry.resolve(null, 2_000);

    expect(repeat.state).toBe(first.state);
    expect(second.id).not.toBe(first.id);
    expect(second.state).not.toBe(first.state);
    expect(first.state.memoryVault.claims).toEqual([]);
    expect(second.state.memoryVault.claims).toEqual([]);
  });

  it("expires inactive public state and bounds the visitor map", () => {
    const registry = new VisitorStateRegistry({
      publicDemo: true,
      localMemoryVault: createEmptyMemoryVault(),
      maximumPublicVisitors: 2,
      publicVisitorTtlMs: PUBLIC_VISITOR_TTL_MS
    });
    const first = registry.resolve(null, 1_000);
    registry.resolve(null, 2_000);
    registry.resolve(null, 3_000);
    expect(registry.activePublicVisitors()).toBe(2);

    const replacement = registry.resolve(first.id, PUBLIC_VISITOR_TTL_MS + 4_000);
    expect(replacement.created).toBe(true);
    expect(registry.activePublicVisitors()).toBe(1);
  });

  it("round-trips an opaque secure visitor cookie", () => {
    const id = crypto.randomUUID();
    const cookie = publicVisitorCookie(id, true);

    expect(visitorIdFromCookie(`theme=dark; ${cookie.split(";")[0]}`)).toBe(id);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(publicVisitorCookie(id, false)).not.toContain("Secure");
    expect(visitorIdFromCookie(`${VISITOR_COOKIE_NAME}=%invalid`)).toBeNull();
  });
});
