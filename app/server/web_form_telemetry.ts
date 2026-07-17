import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  statSync
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { webFormFallbackReasonSchema, webFormProviderSchema } from "../domain/schemas";

const MAX_TELEMETRY_BYTES = 5 * 1024 * 1024;

export const webFormTelemetryInputSchema = z.object({
  event: z.enum(["inspection", "delivery_decision", "preparation", "submission"]),
  provider: webFormProviderSchema,
  outcome: z.enum(["success", "fallback", "error", "uncertain"]),
  durationMs: z.number().int().nonnegative().max(3_600_000).nullable().default(null),
  questionCount: z.number().int().nonnegative().max(10_000).nullable().default(null),
  unsupportedControlCount: z.number().int().nonnegative().max(10_000).nullable().default(null),
  labelCoveragePercent: z.number().min(0).max(100).nullable().default(null),
  recognizedTypeCoveragePercent: z.number().min(0).max(100).nullable().default(null),
  providerIdCoveragePercent: z.number().min(0).max(100).nullable().default(null),
  usableLocatorCoveragePercent: z.number().min(0).max(100).nullable().default(null),
  placedControlCount: z.number().int().nonnegative().max(10_000).nullable().default(null),
  verifiedControlCount: z.number().int().nonnegative().max(10_000).nullable().default(null),
  fallbackReason: webFormFallbackReasonSchema.nullable().default(null),
  failureCode: z.enum([
    "url_policy",
    "browser_unavailable",
    "network",
    "timeout",
    "contract_drift",
    "provider_throttled",
    "resource_limited",
    "verification",
    "interrupted",
    "unknown"
  ]).nullable().default(null)
}).strict();

const webFormTelemetryRecordSchema = webFormTelemetryInputSchema.extend({
  schemaVersion: z.literal(1),
  at: z.string().datetime()
}).strict();

export type WebFormTelemetryInput = z.input<typeof webFormTelemetryInputSchema>;
export type WebFormTelemetryRecord = z.infer<typeof webFormTelemetryRecordSchema>;

export class WebFormOperationalTelemetry {
  readonly filePath: string;

  constructor(workDirectory: string) {
    this.filePath = path.join(workDirectory, "operations", "web_forms.ndjson");
  }

  record(input: unknown, now = new Date()): boolean {
    const parsed = webFormTelemetryInputSchema.safeParse(input);
    if (!parsed.success) return false;
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).size >= MAX_TELEMETRY_BYTES) return false;
      const record = webFormTelemetryRecordSchema.parse({
        ...parsed.data,
        schemaVersion: 1,
        at: now.toISOString()
      });
      mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      chmodSync(this.filePath, 0o600);
      return true;
    } catch {
      return false;
    }
  }
}

export function redactOperationalDiagnostic(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[redacted-url]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, "[redacted-id]")
    .replace(/\b[0-9a-f]{64}\b/giu, "[redacted-fingerprint]")
    .replace(/\bentry\.\d+(?:_sentinel)?\b/giu, "[redacted-provider-id]")
    .replace(/\bQuestionId_[A-Z0-9_-]+\b/giu, "[redacted-provider-id]")
    .replace(/\bprovider_id:[^\s,;]+/giu, "[redacted-provider-id]")
    .replace(/\b(?:tenant|sharetoken|responder|user)_?id\s*[=:]\s*[^\s,;]+/giu, "[redacted-tenant-id]");
}
