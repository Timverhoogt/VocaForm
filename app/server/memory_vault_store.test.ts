import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyMemoryVault } from "../domain/memory";
import { MemoryVaultFileStore } from "./memory_vault_store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local Memory Vault store", () => {
  it("does not create a file merely by loading an empty vault", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vocaform-memory-"));
    temporaryDirectories.push(directory);
    const store = new MemoryVaultFileStore(directory);
    const vault = store.load(new Date("2026-07-14T12:00:00.000Z"));

    expect(vault.claims).toEqual([]);
    expect(() => readFileSync(store.filePath)).toThrow();
  });

  it("round-trips a valid vault through a private local JSON file", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vocaform-memory-"));
    temporaryDirectories.push(directory);
    const store = new MemoryVaultFileStore(directory);
    const vault = createEmptyMemoryVault(new Date("2026-07-14T12:00:00.000Z"));

    store.save(vault);

    expect(store.load()).toEqual(vault);
    expect(statSync(store.filePath).mode & 0o777).toBe(0o600);
  });
});
