import { z } from "zod";
import {
  buildFinishResult,
  buildInterviewContext,
  InterviewValidationError,
  markVoiceUnresolved,
  saveVoiceAnswers
} from "../domain/interview";
import {
  buildSessionMemoryContext,
  confirmMemoryClaimForSession,
  createEmptyMemoryVault,
  MemoryValidationError,
  rememberSessionAnswer
} from "../domain/memory";
import { listFields } from "../domain/session";
import type { FormSession, MemoryVault } from "../domain/schemas";

export const interviewToolNames = [
  "get_interview_context",
  "save_answers",
  "mark_unknown_or_skipped",
  "request_memory_confirmation",
  "remember_answer",
  "confirm_memory_claim",
  "get_remaining_questions",
  "finish_interview"
] as const;

export type InterviewToolName = typeof interviewToolNames[number];

const sessionVersionSchema = z.number().int().nonnegative();
const readArgsSchema = z.object({ sessionVersion: sessionVersionSchema });
const answerValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
const saveAnswersArgsSchema = z.object({
  sessionVersion: sessionVersionSchema,
  answers: z.array(z.object({
    fieldId: z.string().min(1),
    value: answerValueSchema,
    rawAnswer: z.string().min(1),
    confidence: z.number().min(0).max(1)
  })).min(1).max(10)
});
const unresolvedArgsSchema = z.object({
  sessionVersion: sessionVersionSchema,
  fieldId: z.string().min(1),
  disposition: z.enum(["unknown", "skipped"]),
  userWording: z.string().min(1)
});
const memoryArgsSchema = z.object({
  sessionVersion: sessionVersionSchema,
  fieldId: z.string().min(1)
});
const rememberAnswerArgsSchema = z.object({
  sessionVersion: sessionVersionSchema,
  fieldId: z.string().min(1),
  subject: z.string().min(1),
  confirmationWording: z.string().min(1)
});
const confirmMemoryClaimArgsSchema = z.object({
  sessionVersion: sessionVersionSchema,
  fieldId: z.string().min(1),
  claimId: z.string().uuid(),
  confirmationWording: z.string().min(1)
});

export const interviewToolRequestSchema = z.object({
  callId: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  arguments: z.string().max(100_000)
});

export interface InterviewToolOutput {
  ok: boolean;
  tool: string;
  sessionVersion: number;
  [key: string]: unknown;
}

export interface InterviewToolExecution {
  session: FormSession;
  vault: MemoryVault;
  output: InterviewToolOutput;
  cached: boolean;
}

interface CachedExecution {
  sessionId: string;
  fingerprint: string;
  output: InterviewToolOutput;
}

export class InterviewToolExecutor {
  private readonly completed = new Map<string, CachedExecution>();

  execute(
    request: z.infer<typeof interviewToolRequestSchema>,
    session: FormSession,
    vault: MemoryVault = createEmptyMemoryVault()
  ): InterviewToolExecution {
    const fingerprint = `${request.name}\n${request.arguments}`;
    const existing = this.completed.get(request.callId);
    if (existing) {
      if (existing.sessionId !== session.id || existing.fingerprint !== fingerprint) {
        return {
          session,
          vault,
          cached: true,
          output: failureOutput(
            request.name,
            session,
            vault,
            "call_id_reuse",
            "This tool-call ID was already used for a different operation."
          )
        };
      }
      return { session, vault, cached: true, output: existing.output };
    }

    let execution: InterviewToolExecution;
    try {
      execution = this.executeUncached(request, session, vault);
    } catch (error) {
      execution = {
        session,
        vault,
        cached: false,
        output: toolErrorOutput(request.name, session, vault, error)
      };
    }
    this.completed.set(request.callId, {
      sessionId: session.id,
      fingerprint,
      output: execution.output
    });
    if (this.completed.size > 500) {
      const oldest = this.completed.keys().next().value;
      if (oldest) this.completed.delete(oldest);
    }
    return execution;
  }

  reset(): void {
    this.completed.clear();
  }

  private executeUncached(
    request: z.infer<typeof interviewToolRequestSchema>,
    session: FormSession,
    vault: MemoryVault
  ): InterviewToolExecution {
    const args = parseArguments(request.arguments);
    if (request.name === "get_interview_context") {
      readArgsSchema.parse(args);
      return success(session, vault, request.name, { context: interviewContext(session, vault) });
    }
    if (request.name === "get_remaining_questions") {
      readArgsSchema.parse(args);
      const context = interviewContext(session, vault);
      return success(session, vault, request.name, {
        remainingQuestions: context.remainingQuestions,
        requiredOpen: context.requiredOpen,
        completionPercent: context.completionPercent
      });
    }
    if (request.name === "save_answers") {
      const parsed = saveAnswersArgsSchema.parse(args);
      requireVersion(session, parsed.sessionVersion);
      const next = saveVoiceAnswers(session, parsed.answers.map((answer) => ({
        ...answer,
        value: answer.value
      })));
      return success(next, vault, request.name, {
        savedFieldIds: parsed.answers.map((answer) => answer.fieldId),
        context: interviewContext(next, vault)
      });
    }
    if (request.name === "mark_unknown_or_skipped") {
      const parsed = unresolvedArgsSchema.parse(args);
      requireVersion(session, parsed.sessionVersion);
      const next = markVoiceUnresolved(
        session,
        parsed.fieldId,
        parsed.disposition,
        parsed.userWording
      );
      return success(next, vault, request.name, {
        fieldId: parsed.fieldId,
        disposition: parsed.disposition,
        context: interviewContext(next, vault)
      });
    }
    if (request.name === "request_memory_confirmation") {
      const parsed = memoryArgsSchema.parse(args);
      requireVersion(session, parsed.sessionVersion);
      const field = listFields(session.form).find((candidate) => candidate.id === parsed.fieldId);
      if (!field) throw new InterviewValidationError("unknown_field", `Unknown field: ${parsed.fieldId}.`);
      const candidate = buildSessionMemoryContext(vault, session).rememberableAnswers
        .find((item) => item.fieldId === parsed.fieldId);
      return success(session, vault, request.name, {
        fieldId: parsed.fieldId,
        eligible: Boolean(candidate),
        candidate: candidate ?? null,
        memoryKey: candidate?.key ?? null,
        requiresExplicitConfirmation: true,
        stored: false,
        message: candidate
          ? "Ask the user for explicit confirmation. Nothing is stored until they say yes."
          : "This answer is not eligible for memory. Do not ask to store it."
      });
    }
    if (request.name === "remember_answer") {
      const parsed = rememberAnswerArgsSchema.parse(args);
      requireVersion(session, parsed.sessionVersion);
      const nextVault = rememberSessionAnswer(
        vault,
        session,
        parsed.fieldId,
        parsed.subject,
        { channel: "voice", confirmationWording: parsed.confirmationWording }
      );
      const claim = nextVault.claims.find(
        (candidate) => candidate.sourceSessionId === session.id
          && candidate.sourceFieldId === parsed.fieldId
      );
      return success(session, nextVault, request.name, {
        stored: true,
        fieldId: parsed.fieldId,
        claimId: claim?.id ?? null,
        context: interviewContext(session, nextVault)
      });
    }
    if (request.name === "confirm_memory_claim") {
      const parsed = confirmMemoryClaimArgsSchema.parse(args);
      requireVersion(session, parsed.sessionVersion);
      const next = confirmMemoryClaimForSession(
        session,
        vault,
        parsed.fieldId,
        parsed.claimId,
        { channel: "voice", confirmationWording: parsed.confirmationWording }
      );
      return success(next, vault, request.name, {
        applied: true,
        fieldId: parsed.fieldId,
        claimId: parsed.claimId,
        context: interviewContext(next, vault)
      });
    }
    if (request.name === "finish_interview") {
      readArgsSchema.parse(args);
      const finish = buildFinishResult(session);
      return success(session, vault, request.name, finish);
    }
    throw new InterviewValidationError("unknown_tool", `Unknown interview tool: ${request.name}.`);
  }
}

export function buildRealtimeToolDefinitions(): Array<Record<string, unknown>> {
  return [
    tool("get_interview_context", "Read the current server-owned interview state before asking a question or after reconnecting.", readArgsSchema),
    tool("save_answers", "Atomically save one or more answers explicitly stated by the user. Never infer missing values. Use canonical types: booleans as true/false, numbers as numbers, dates as YYYY-MM-DD, and choices exactly as shown.", saveAnswersArgsSchema),
    tool("mark_unknown_or_skipped", "Record that the user explicitly does not know an answer or wants to skip it. Include their exact wording as provenance.", unresolvedArgsSchema),
    tool("request_memory_confirmation", "Check whether an answered field is a safe stable contact fact that may be remembered. This never stores anything. Ask for explicit permission after a positive result.", memoryArgsSchema),
    tool("remember_answer", "Store one safe stable contact answer only after the user explicitly says to remember it. Include their exact confirmation wording and the subject the fact describes.", rememberAnswerArgsSchema),
    tool("confirm_memory_claim", "Apply one suggested remembered fact to this form only after the user explicitly confirms that exact suggestion. Include their exact confirmation wording.", confirmMemoryClaimArgsSchema),
    tool("get_remaining_questions", "Read the current applicable unanswered questions and progress after a save or when planning the next question.", readArgsSchema),
    tool("finish_interview", "Check whether the interview may finish. Do not claim completion unless canFinish is true.", readArgsSchema)
  ];
}

function success(
  session: FormSession,
  vault: MemoryVault,
  toolName: string,
  details: Record<string, unknown>
): InterviewToolExecution {
  return {
    session,
    vault,
    cached: false,
    output: { ok: true, tool: toolName, sessionVersion: session.version, ...details }
  };
}

function requireVersion(session: FormSession, expected: number): void {
  if (session.version !== expected) {
    throw new InterviewValidationError(
      "version_conflict",
      `The form is now at version ${session.version}; refresh context before writing.`
    );
  }
}

function parseArguments(value: string): unknown {
  try {
    return value ? JSON.parse(value) as unknown : {};
  } catch {
    throw new InterviewValidationError("invalid_arguments", "Tool arguments must be valid JSON.");
  }
}

function tool(name: InterviewToolName, description: string, schema: z.ZodType): Record<string, unknown> {
  const parameters = z.toJSONSchema(schema) as Record<string, unknown>;
  delete parameters.$schema;
  return { type: "function", name, description, parameters };
}

function toolErrorOutput(
  name: string,
  session: FormSession,
  vault: MemoryVault,
  error: unknown
): InterviewToolOutput {
  if (error instanceof InterviewValidationError) {
    return failureOutput(name, session, vault, error.code, error.message);
  }
  if (error instanceof MemoryValidationError) {
    return failureOutput(name, session, vault, error.code, error.message);
  }
  if (error instanceof z.ZodError) {
    return failureOutput(
      name,
      session,
      vault,
      "invalid_arguments",
      error.issues[0]?.message || "The tool arguments were invalid."
    );
  }
  return failureOutput(name, session, vault, "tool_error", "The tool could not be completed safely.");
}

function failureOutput(
  name: string,
  session: FormSession,
  vault: MemoryVault,
  code: string,
  message: string
): InterviewToolOutput {
  return {
    ok: false,
    tool: name,
    sessionVersion: session.version,
    error: { code, message },
    context: interviewContext(session, vault)
  };
}

function interviewContext(session: FormSession, vault: MemoryVault) {
  return buildInterviewContext(session, buildSessionMemoryContext(vault, session));
}
