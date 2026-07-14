import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createEmptyMemoryVault } from "../domain/memory";
import { memoryVaultSchema, type MemoryVault } from "../domain/schemas";

export class MemoryVaultFileStore {
  readonly filePath: string;

  constructor(workDirectory: string) {
    this.filePath = path.join(workDirectory, "memory_vault.local.json");
  }

  load(now = new Date()): MemoryVault {
    if (!existsSync(this.filePath)) return createEmptyMemoryVault(now);
    try {
      return memoryVaultSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")) as unknown);
    } catch (error) {
      const detail = error instanceof z.ZodError
        ? error.issues[0]?.message
        : error instanceof Error ? error.message : "Unknown file error";
      throw new Error(`The local Memory Vault is invalid: ${detail}`, { cause: error });
    }
  }

  save(vault: MemoryVault): void {
    const parsed = memoryVaultSchema.parse(vault);
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      renameSync(temporaryPath, this.filePath);
      chmodSync(this.filePath, 0o600);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}
