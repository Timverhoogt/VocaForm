import { describe, expect, it } from "vitest";
import { getConfig } from "./config";

describe("server configuration", () => {
  it("keeps local development private by default", () => {
    const config = getConfig({});

    expect(config.publicDemo).toBe(false);
    expect(config.storageMode).toBe("local");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(5177);
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
});
