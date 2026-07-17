import { describe, expect, it } from "vitest";
import { getConfig } from "./config";

describe("server configuration", () => {
  it("keeps local development private by default", () => {
    const config = getConfig({});

    expect(config.publicDemo).toBe(false);
    expect(config.storageMode).toBe("local");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(5177);
    expect(config.webFormNativePreparation).toBe(true);
    expect(config.webFormMaxConcurrentSessions).toBe(4);
  });

  it.each(["1", "true", "TRUE", "yes", "on"])("recognizes %s as public demo mode", (value) => {
    expect(getConfig({ VOCAFORM_PUBLIC_DEMO: value }).publicDemo).toBe(true);
  });

  it("does not enable public demo mode for an arbitrary value", () => {
    expect(getConfig({ VOCAFORM_PUBLIC_DEMO: "enabled" }).publicDemo).toBe(false);
  });

  it("requires an explicit ephemeral storage declaration", () => {
    expect(getConfig({ VOCAFORM_STORAGE_MODE: "ephemeral" }).storageMode).toBe("ephemeral");
    expect(getConfig({ VOCAFORM_PUBLIC_DEMO: "true" }).storageMode).toBe("local");
    expect(getConfig({ VOCAFORM_STORAGE_MODE: "temporary" }).storageMode).toBe("local");
  });

  it("allows native preparation to be disabled without changing deterministic checks", () => {
    expect(getConfig({ VOCAFORM_WEBFORM_NATIVE_PREPARATION: "false" }).webFormNativePreparation).toBe(false);
    expect(getConfig({ VOCAFORM_WEBFORM_NATIVE_PREPARATION: "true" }).webFormNativePreparation).toBe(true);
  });

  it("bounds browser resource and timeout settings", () => {
    const config = getConfig({
      VOCAFORM_PUBLIC_DEMO: "true",
      VOCAFORM_WEBFORM_INSPECTION_TIMEOUT_MS: "1",
      VOCAFORM_WEBFORM_ACTION_TIMEOUT_MS: "999999",
      VOCAFORM_WEBFORM_SESSION_TTL_MS: "120000",
      VOCAFORM_WEBFORM_MAX_CONCURRENT_SESSIONS: "99",
      VOCAFORM_WEBFORM_MAX_REQUESTS: "20"
    });

    expect(config.webFormInspectionTimeoutMs).toBe(5_000);
    expect(config.webFormActionTimeoutMs).toBe(30_000);
    expect(config.webFormSessionTtlMs).toBe(120_000);
    expect(config.webFormMaxConcurrentSessions).toBe(8);
    expect(config.webFormMaxRequests).toBe(50);
  });
});
