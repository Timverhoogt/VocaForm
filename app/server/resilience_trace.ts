import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  statSync
} from "node:fs";
import path from "node:path";
import { z } from "zod";

const MAX_TRACE_BYTES = 5 * 1024 * 1024;

const traceEventSchema = z.enum([
  "compiler",
  "final_verifier",
  "realtime_connection",
  "realtime_first_response",
  "interview_tool",
  "document_export"
]);

const interviewToolTraceNameSchema = z.enum([
  "get_interview_context",
  "save_answers",
  "mark_unknown_or_skipped",
  "request_memory_confirmation",
  "remember_answer",
  "confirm_memory_claim",
  "get_remaining_questions",
  "finish_interview",
  "unknown"
]);

export const resilienceTraceInputSchema = z.object({
  event: traceEventSchema,
  outcome: z.enum(["success", "error"]),
  durationMs: z.number().int().nonnegative().max(3_600_000).nullable().default(null),
  inputTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable().default(null),
  tool: interviewToolTraceNameSchema.nullable().default(null),
  cached: z.boolean().nullable().default(null),
  renderKind: z.enum(["filled_docx", "filled_pdf", "answer_packet"]).nullable().default(null),
  coveragePercent: z.number().min(0).max(100).nullable().default(null),
  fallbackCount: z.number().int().nonnegative().nullable().default(null)
}).strict();

export const clientResilienceMetricSchema = z.object({
  event: z.literal("realtime_first_response"),
  outcome: z.literal("success"),
  durationMs: z.number().int().nonnegative().max(3_600_000)
}).strict();

const resilienceTraceRecordSchema = resilienceTraceInputSchema.extend({
  schemaVersion: z.literal(1),
  at: z.string().datetime()
}).strict();

export type ResilienceTraceInput = z.input<typeof resilienceTraceInputSchema>;
export type ResilienceTraceRecord = z.infer<typeof resilienceTraceRecordSchema>;
export type InterviewToolTraceName = z.infer<typeof interviewToolTraceNameSchema>;

export class ResilienceTracer {
  readonly filePath: string;

  constructor(workDirectory: string) {
    this.filePath = path.join(workDirectory, "resilience", "traces.ndjson");
  }

  record(input: unknown, now = new Date()): boolean {
    const parsed = resilienceTraceInputSchema.safeParse(input);
    if (!parsed.success) return false;
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).size >= MAX_TRACE_BYTES) return false;
      const record = resilienceTraceRecordSchema.parse({
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

export function normalizeInterviewToolTraceName(value: string): InterviewToolTraceName {
  const parsed = interviewToolTraceNameSchema.safeParse(value);
  return parsed.success ? parsed.data : "unknown";
}

export function elapsedMilliseconds(startedAt: number, endedAt = performance.now()): number {
  return Math.max(0, Math.round(endedAt - startedAt));
}
