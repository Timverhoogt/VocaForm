import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import {
  buildDocumentExportPlan,
  DocumentRenderError,
  renderDraftDocument,
  renderVerifiedDocument,
  type RenderedDocument
} from "../adapters/document_renderer";
import { AnswerValidationError } from "../domain/answers";
import { evaluateCompilation, toFormDefinition } from "../domain/compiler";
import {
  buildSessionMemoryContext,
  confirmMemoryClaimForSession,
  correctMemoryClaim,
  createEmptyMemoryVault,
  forgetMemoryClaim,
  MemoryValidationError,
  rememberSessionAnswer
} from "../domain/memory";
import {
  answerValueSchema,
  verificationActionSchema,
  type FormSession,
  type MemoryVault
} from "../domain/schemas";
import {
  createFormSession,
  nextOpenField,
  saveTextAnswer,
  skipAnswer,
  summarizeSession,
  verifySession
} from "../domain/session";
import {
  buildFinalVerification,
  createSemanticIssues,
  resolveVerificationIssue,
  VerificationValidationError
} from "../domain/verification";
import type {
  HealthPayload,
  MemoryMutationResponse,
  MemoryVaultView,
  SessionView
} from "../shared/api";
import { getConfig } from "./config";
import { prepareCompilerDocument } from "./document_upload";
import { listFixtures, loadFixture, loadFixtureSource } from "./fixtures";
import { OpenAiFinalVerifier } from "./final_verifier";
import { OpenAiFormCompiler } from "./form_compiler";
import { interviewToolRequestSchema } from "./interview_tools";
import { MemoryVaultFileStore } from "./memory_vault_store";
import { PublicDemoRateLimiter, type PublicModelOperation } from "./public_demo_rate_limit";
import { buildRealtimeSessionConfig } from "./realtime_session";
import {
  clientResilienceMetricSchema,
  elapsedMilliseconds,
  normalizeInterviewToolTraceName,
  ResilienceTracer
} from "./resilience_trace";
import {
  publicVisitorCookie,
  type VisitorState,
  VisitorStateRegistry,
  visitorIdFromCookie
} from "./visitor_state";

const config = getConfig();
const clientDirectory = path.resolve("dist/client");
const jsonBodySchema = z.object({}).passthrough();
const fixtureRequestSchema = z.object({ fixtureId: z.string().min(1) });
const answerRequestSchema = z.object({
  fieldId: z.string().min(1),
  value: z.union([
    z.string().min(1),
    z.array(z.string().min(1)).min(1)
  ]),
  sessionVersion: z.number().int().nonnegative()
});
const skipRequestSchema = z.object({
  fieldId: z.string().min(1),
  sessionVersion: z.number().int().nonnegative()
});
const compiledSessionRequestSchema = z.object({ compilationId: z.string().uuid() });
const rememberAnswerRequestSchema = z.object({
  fieldId: z.string().min(1),
  subject: z.string().min(1),
  sessionVersion: z.number().int().nonnegative()
});
const applyMemoryRequestSchema = z.object({
  fieldId: z.string().min(1),
  claimId: z.string().uuid(),
  sessionVersion: z.number().int().nonnegative()
});
const correctMemoryRequestSchema = z.object({ value: answerValueSchema });
const verificationRequestSchema = z.object({
  sessionVersion: z.number().int().nonnegative()
});
const verificationResolutionRequestSchema = z.object({
  action: verificationActionSchema,
  fieldId: z.string().min(1).nullable().default(null),
  value: z.string().nullable().default(null),
  sessionVersion: z.number().int().nonnegative()
});

let formCompiler: OpenAiFormCompiler | null = null;
let finalVerifier: OpenAiFinalVerifier | null = null;
const memoryVaultStore = new MemoryVaultFileStore(config.workDir);
const resilienceTracer = new ResilienceTracer(config.workDir);
const publicDemoRateLimiter = new PublicDemoRateLimiter();
const visitorStates = new VisitorStateRegistry({
  publicDemo: config.publicDemo,
  localMemoryVault: config.publicDemo ? createEmptyMemoryVault() : memoryVaultStore.load()
});

const server = createServer((request, response) => {
  void routeRequest(request, response).catch((error: unknown) => {
    const normalized = normalizeHttpError(error);
    if (normalized.status === 500 || normalized.status === 502) console.error(normalized.logMessage);
    sendJson(response, normalized.status, { error: normalized.message });
  });
});

server.listen(config.port, config.host, () => {
  console.log(`VocaForm API listening at http://${config.host}:${config.port}`);
  console.log(`OpenAI API key: ${config.openAiApiKey ? "configured" : "not configured"}`);
});

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const method = request.method || "GET";
  const visitor = visitorStates.resolve(visitorIdFromCookie(request.headers.cookie));
  const state = visitor.state;
  if (config.publicDemo && visitor.created) {
    response.setHeader("Set-Cookie", publicVisitorCookie(visitor.id, isSecureRequest(request)));
  }

  if (method === "GET" && url.pathname === "/api/health") {
    const payload: HealthPayload = {
      status: "ok",
      version: packageJson.version,
      deployment: {
        publicDemo: config.publicDemo,
        storage: config.storageMode
      },
      openai: {
        configured: Boolean(config.openAiApiKey),
        model: config.openAiModel,
        realtimeModel: config.openAiRealtimeModel,
        verificationModel: config.openAiVerificationModel,
        verificationMode: config.openAiVerificationReasoningMode
      }
    };
    sendJson(response, 200, payload);
    return;
  }

  if (method === "GET" && url.pathname === "/api/fixtures") {
    sendJson(response, 200, { fixtures: listFixtures() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/memory") {
    sendJson(response, 200, buildMemoryVaultView(state.memoryVault));
    return;
  }

  if (method === "POST" && url.pathname === "/api/resilience/metric") {
    const metric = clientResilienceMetricSchema.parse(await readJsonBody(request, 10_000));
    resilienceTracer.record(metric);
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/api/compilation") {
    if (!state.compilation) throw new HttpError(404, "No compiled form is available.");
    sendJson(response, 200, state.compilation);
    return;
  }

  if (method === "POST" && url.pathname === "/api/forms/compile") {
    if (!config.openAiApiKey) {
      throw new HttpError(503, "Add OPENAI_API_KEY to the server environment before uploading a form.");
    }
    enforcePublicModelLimit("compile", visitor.id, request, response);
    const startedAt = performance.now();
    let document: Awaited<ReturnType<typeof prepareCompilerDocument>>;
    try {
      document = await prepareCompilerDocument(await readJsonBody(request, 15_000_000), {
        sofficeBin: config.sofficeBin
      });
    } catch (error) {
      resilienceTracer.record({
        event: "compiler",
        outcome: "error",
        durationMs: elapsedMilliseconds(startedAt)
      });
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : "The uploaded document is invalid.";
      throw new HttpError(400, message);
    }
    formCompiler ??= new OpenAiFormCompiler(config);
    let modelResult;
    try {
      modelResult = await formCompiler.compile(document);
    } catch (error) {
      resilienceTracer.record({
        event: "compiler",
        outcome: "error",
        durationMs: elapsedMilliseconds(startedAt)
      });
      const detail = error instanceof Error ? error.message : "Unknown model error.";
      throw new HttpError(502, `The form could not be compiled. ${detail}`);
    }
    const readiness = evaluateCompilation(modelResult.output, document.searchableText);
    const hasFields = modelResult.output.sections.some((section) => section.fields.length > 0);
    const form = hasFields
      ? toFormDefinition(modelResult.output, {
          fileName: document.fileName,
          format: document.format,
          searchableText: document.searchableText
        })
      : null;
    const compilationId = crypto.randomUUID();
    state.compilation = {
      id: compilationId,
      form,
      documentSummary: modelResult.output.document.summary,
      readiness,
      metadata: {
        model: config.openAiModel,
        responseId: modelResult.responseId,
        compiledAt: new Date().toISOString(),
        byteLength: document.byteLength,
        visualStrategy: document.visualStrategy,
        originalRetained: document.originalRetained,
        inputTokens: modelResult.inputTokens,
        outputTokens: modelResult.outputTokens
      }
    };
    state.compilationSource = {
      compilationId,
      document: {
        fileName: document.fileName,
        format: document.format === "fixture" ? "text" : document.format,
        bytes: Buffer.from(document.originalBytes)
      }
    };
    state.session = null;
    state.sessionSource = null;
    state.semanticVerification = null;
    resilienceTracer.record({
      event: "compiler",
      outcome: "success",
      durationMs: elapsedMilliseconds(startedAt),
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens
    });
    sendJson(response, 201, state.compilation);
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/compiled") {
    const body = compiledSessionRequestSchema.parse(await readJsonBody(request));
    if (!state.compilation || state.compilation.id !== body.compilationId) {
      throw new HttpError(404, "That compiled form is no longer available.");
    }
    if (!state.compilation.readiness.ready || !state.compilation.form) {
      throw new HttpError(422, "Resolve the readiness blockers before starting the interview.");
    }
    state.session = createFormSession(state.compilation.form);
    state.sessionSource = state.compilationSource?.compilationId === state.compilation.id
      ? state.compilationSource.document
      : null;
    state.semanticVerification = null;
    state.interviewToolExecutor.reset();
    sendJson(response, 201, buildSessionView(state, state.session));
    return;
  }

  if (method === "GET" && url.pathname === "/api/session") {
    if (!state.session) {
      sendJson(response, 404, { error: "No form session is active." });
      return;
    }
    sendJson(response, 200, buildSessionView(state, state.session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/fixture") {
    const body = fixtureRequestSchema.parse(await readJsonBody(request));
    const [form, source] = await Promise.all([
      loadFixture(body.fixtureId),
      loadFixtureSource(body.fixtureId)
    ]);
    state.session = createFormSession(form);
    state.sessionSource = source;
    state.compilation = null;
    state.compilationSource = null;
    state.semanticVerification = null;
    state.interviewToolExecutor.reset();
    sendJson(response, 201, buildSessionView(state, state.session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/answer") {
    const body = answerRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    state.session = saveTextAnswer(session, body.fieldId, body.value);
    state.semanticVerification = null;
    sendJson(response, 200, buildSessionView(state, state.session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/skip") {
    const body = skipRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    state.session = skipAnswer(session, body.fieldId);
    state.semanticVerification = null;
    sendJson(response, 200, buildSessionView(state, state.session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/verify") {
    const body = verificationRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    const deterministic = verifySession(session, new Date(), {
      approvedMemoryClaimIds: approvedMemoryClaimIds(state)
    });
    if (deterministic.issues.some((issue) => issue.severity === "blocker" && !issue.resolved)) {
      state.semanticVerification = null;
      sendJson(response, 200, buildSessionView(state, session));
      return;
    }
    if (!config.openAiApiKey) {
      state.semanticVerification = null;
      sendJson(response, 200, buildSessionView(state, session));
      return;
    }
    enforcePublicModelLimit("verify", visitor.id, request, response);

    const expectedSessionId = session.id;
    const expectedVersion = session.version;
    const checkedAt = new Date().toISOString();
    const startedAt = performance.now();
    finalVerifier ??= new OpenAiFinalVerifier(config);
    try {
      const result = await finalVerifier.verify(session);
      if (!state.session || state.session.id !== expectedSessionId || state.session.version !== expectedVersion) {
        throw new HttpError(409, "This form changed while verification was running. Run the check again.");
      }
      state.semanticVerification = {
        sessionId: session.id,
        sessionVersion: session.version,
        status: "completed",
        issues: createSemanticIssues(session, result.output),
        model: config.openAiVerificationModel,
        mode: config.openAiVerificationReasoningMode,
        responseId: result.responseId,
        checkedAt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
      };
      resilienceTracer.record({
        event: "final_verifier",
        outcome: "success",
        durationMs: elapsedMilliseconds(startedAt),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
      });
    } catch (error) {
      resilienceTracer.record({
        event: "final_verifier",
        outcome: "error",
        durationMs: elapsedMilliseconds(startedAt)
      });
      if (error instanceof HttpError) throw error;
      if (!state.session || state.session.id !== expectedSessionId || state.session.version !== expectedVersion) {
        throw new HttpError(409, "This form changed while verification was running. Run the check again.");
      }
      const detail = error instanceof Error ? error.message : "Unknown verifier error.";
      console.error(`Final verification failed: ${detail}`);
      state.semanticVerification = {
        sessionId: session.id,
        sessionVersion: session.version,
        status: "error",
        issues: [],
        model: config.openAiVerificationModel,
        mode: config.openAiVerificationReasoningMode,
        responseId: null,
        checkedAt,
        inputTokens: null,
        outputTokens: null
      };
    }
    sendJson(response, 200, buildSessionView(state, session));
    return;
  }

  const verificationResolutionMatch = url.pathname.match(/^\/api\/session\/verification\/issues\/([^/]+)\/resolve$/);
  if (method === "POST" && verificationResolutionMatch) {
    const issueId = decodeURIComponent(verificationResolutionMatch[1] as string);
    const body = verificationResolutionRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    const issue = buildSessionView(state, session).verification.issues.find((candidate) => candidate.id === issueId);
    if (!issue) throw new HttpError(404, "That verification finding is no longer active.");
    const previousRun = state.semanticVerification;
    const resolution = resolveVerificationIssue(session, issue, body);
    state.session = resolution.session;
    if (!resolution.answerChanged
      && previousRun?.sessionId === session.id
      && previousRun.sessionVersion === session.version) {
      state.semanticVerification = { ...previousRun, sessionVersion: state.session.version };
    } else {
      state.semanticVerification = null;
    }
    sendJson(response, 200, buildSessionView(state, state.session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/memory/remember") {
    const body = rememberAnswerRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    const nextVault = rememberSessionAnswer(
      state.memoryVault,
      session,
      body.fieldId,
      body.subject,
      { channel: "ui" }
    );
    persistMemoryVault(state, nextVault);
    sendJson(response, 200, buildMemoryMutationResponse(state));
    return;
  }

  if (method === "POST" && url.pathname === "/api/memory/apply") {
    const body = applyMemoryRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    state.session = confirmMemoryClaimForSession(
      session,
      state.memoryVault,
      body.fieldId,
      body.claimId,
      { channel: "ui" }
    );
    state.semanticVerification = null;
    sendJson(response, 200, buildMemoryMutationResponse(state));
    return;
  }

  const memoryClaimMatch = url.pathname.match(/^\/api\/memory\/claims\/([^/]+)$/);
  if (memoryClaimMatch && method === "PATCH") {
    const claimId = z.string().uuid().parse(decodeURIComponent(memoryClaimMatch[1] as string));
    const body = correctMemoryRequestSchema.parse(await readJsonBody(request));
    persistMemoryVault(state, correctMemoryClaim(state.memoryVault, claimId, body.value));
    sendJson(response, 200, buildMemoryMutationResponse(state));
    return;
  }

  if (memoryClaimMatch && method === "DELETE") {
    const claimId = z.string().uuid().parse(decodeURIComponent(memoryClaimMatch[1] as string));
    persistMemoryVault(state, forgetMemoryClaim(state.memoryVault, claimId));
    sendJson(response, 200, buildMemoryMutationResponse(state));
    return;
  }

  if (method === "POST" && url.pathname === "/api/interview/tool") {
    const body = interviewToolRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state);
    const startedAt = performance.now();
    const execution = state.interviewToolExecutor.execute(body, session, state.memoryVault);
    if (execution.vault.version !== state.memoryVault.version) {
      try {
        persistMemoryVault(state, execution.vault);
      } catch (error) {
        state.interviewToolExecutor.reset();
        resilienceTracer.record({
          event: "interview_tool",
          outcome: "error",
          durationMs: elapsedMilliseconds(startedAt),
          tool: normalizeInterviewToolTraceName(body.name),
          cached: execution.cached
        });
        throw error;
      }
    }
    if (execution.session.version !== session.version) state.semanticVerification = null;
    state.session = execution.session;
    resilienceTracer.record({
      event: "interview_tool",
      outcome: execution.output.ok ? "success" : "error",
      durationMs: elapsedMilliseconds(startedAt),
      tool: normalizeInterviewToolTraceName(body.name),
      cached: execution.cached
    });
    sendJson(response, 200, {
      output: execution.output,
      view: buildSessionView(state, state.session),
      cached: execution.cached
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/realtime/call") {
    if (!config.openAiApiKey) {
      throw new HttpError(503, "Add OPENAI_API_KEY before starting a voice interview.");
    }
    const session = requireCurrentSession(state);
    const sdp = await readTextBody(request, 200_000);
    if (!sdp.includes("v=0")) throw new HttpError(400, "The WebRTC offer is invalid.");
    enforcePublicModelLimit("realtime", visitor.id, request, response);
    const formData = new FormData();
    formData.set("sdp", sdp);
    formData.set("session", JSON.stringify(buildRealtimeSessionConfig(session, config)));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.openAiApiKey}`
    };
    if (config.openAiSafetyIdentifier) {
      headers["OpenAI-Safety-Identifier"] = config.openAiSafetyIdentifier;
    }
    const startedAt = performance.now();
    let upstream: Response;
    try {
      upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers,
        body: formData
      });
    } catch {
      resilienceTracer.record({
        event: "realtime_connection",
        outcome: "error",
        durationMs: elapsedMilliseconds(startedAt)
      });
      throw new HttpError(502, "The voice interview could not connect. Please try again.");
    }
    const body = await upstream.text();
    if (!upstream.ok) {
      resilienceTracer.record({
        event: "realtime_connection",
        outcome: "error",
        durationMs: elapsedMilliseconds(startedAt)
      });
      console.error(`OpenAI Realtime call failed (${upstream.status}).`);
      throw new HttpError(502, "The voice interview could not connect. Please try again.");
    }
    resilienceTracer.record({
      event: "realtime_connection",
      outcome: "success",
      durationMs: elapsedMilliseconds(startedAt)
    });
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/sdp",
      "Content-Length": Buffer.byteLength(body)
    });
    response.end(body);
    return;
  }

  if (method === "DELETE" && url.pathname === "/api/session") {
    state.session = null;
    state.sessionSource = null;
    state.semanticVerification = null;
    state.interviewToolExecutor.reset();
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (method === "DELETE" && url.pathname === "/api/compilation") {
    state.compilation = null;
    state.compilationSource = null;
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (method === "POST" && url.pathname === "/api/export/draft") {
    const session = requireCurrentSession(state);
    const startedAt = performance.now();
    try {
      const document = renderDraftDocument(session);
      recordDocumentExport(document, startedAt);
      sendDocument(response, document);
    } catch (error) {
      resilienceTracer.record({
        event: "document_export",
        outcome: "error",
        durationMs: elapsedMilliseconds(startedAt)
      });
      throw error;
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/export/final") {
    const session = requireCurrentSession(state);
    const verification = buildFinalVerification(session, {
      approvedMemoryClaimIds: approvedMemoryClaimIds(state),
      modelAvailable: Boolean(config.openAiApiKey),
      semanticRun: state.semanticVerification
    });
    if (!verification.readyForFinalExport) {
      throw new HttpError(422, "Resolve every blocking finding and run final verification before exporting.");
    }
    const startedAt = performance.now();
    try {
      const document = await renderVerifiedDocument(session, state.sessionSource);
      recordDocumentExport(document, startedAt);
      sendDocument(response, document);
    } catch (error) {
      resilienceTracer.record({
        event: "document_export",
        outcome: "error",
        durationMs: elapsedMilliseconds(startedAt)
      });
      throw error;
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }

  await serveClient(url.pathname, response);
}

function buildSessionView(state: VisitorState, session: FormSession): SessionView {
  return {
    session,
    summary: summarizeSession(session),
    verification: buildFinalVerification(session, {
      approvedMemoryClaimIds: approvedMemoryClaimIds(state),
      modelAvailable: Boolean(config.openAiApiKey),
      semanticRun: state.semanticVerification
    }),
    nextField: nextOpenField(session),
    memory: buildSessionMemoryContext(state.memoryVault, session),
    exportPlan: buildDocumentExportPlan(session, state.sessionSource)
  };
}

function approvedMemoryClaimIds(state: VisitorState): Set<string> {
  return new Set(state.memoryVault.claims
    .filter((claim) => claim.consent === "approved")
    .map((claim) => claim.id));
}

function buildMemoryVaultView(vault: MemoryVault): MemoryVaultView {
  return {
    version: vault.version,
    claims: [...vault.claims].sort((left, right) => left.subject.localeCompare(right.subject)
      || left.key.localeCompare(right.key)),
    updatedAt: vault.updatedAt
  };
}

function buildMemoryMutationResponse(state: VisitorState): MemoryMutationResponse {
  return {
    memory: buildMemoryVaultView(state.memoryVault),
    view: state.session ? buildSessionView(state, state.session) : null
  };
}

function persistMemoryVault(state: VisitorState, vault: MemoryVault): void {
  if (!config.publicDemo) memoryVaultStore.save(vault);
  state.memoryVault = vault;
}

function requireCurrentSession(state: VisitorState, expectedVersion?: number): FormSession {
  if (!state.session) throw new HttpError(404, "No form session is active.");
  if (expectedVersion !== undefined && state.session.version !== expectedVersion) {
    throw new HttpError(409, "This form changed in another request. Refresh and try again.");
  }
  return state.session;
}

function enforcePublicModelLimit(
  operation: PublicModelOperation,
  visitorId: string,
  request: IncomingMessage,
  response: ServerResponse
): void {
  if (!config.publicDemo) return;
  const address = clientAddress(request);
  const result = publicDemoRateLimiter.consume(operation, visitorId, address);
  if (result.allowed) return;
  response.setHeader("Retry-After", String(result.retryAfterSeconds));
  throw new HttpError(429,
    "This public demo has reached its temporary AI request limit. Continue with a reviewed sample or try again later.");
}

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return firstForwarded?.trim() || request.socket.remoteAddress || "unknown";
}

function isSecureRequest(request: IncomingMessage): boolean {
  const forwarded = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return protocol?.trim().toLowerCase() === "https";
}

async function readJsonBody(request: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return jsonBodySchema.parse(raw ? JSON.parse(raw) as unknown : {});
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw new HttpError(400, "Request body must contain valid JSON.");
  }
}

async function readTextBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function normalizeHttpError(error: unknown): { status: number; message: string; logMessage: string } {
  if (error instanceof HttpError) {
    return { status: error.status, message: error.message, logMessage: error.message };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      message: error.issues[0]?.message || "The request was invalid.",
      logMessage: error.message
    };
  }
  if (error instanceof MemoryValidationError) {
    return { status: 422, message: error.message, logMessage: error.message };
  }
  if (error instanceof AnswerValidationError || error instanceof VerificationValidationError) {
    return { status: 422, message: error.message, logMessage: error.message };
  }
  if (error instanceof DocumentRenderError) {
    return { status: 422, message: error.message, logMessage: error.message };
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return { status: 500, message: "VocaForm encountered an unexpected server error.", logMessage: message };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function sendDocument(response: ServerResponse, document: RenderedDocument): void {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${document.fileName}"`,
    "Content-Length": document.bytes.length,
    "Content-Type": document.contentType,
    "X-VocaForm-Render-Kind": document.kind,
    "X-VocaForm-Render-Coverage": String(document.report.coveragePercent),
    "X-VocaForm-Render-Fallbacks": String(document.report.fallbackCount),
    "X-VocaForm-Source-Preserved": String(document.report.sourcePreserved)
  });
  response.end(document.bytes);
}

function recordDocumentExport(document: RenderedDocument, startedAt: number): void {
  resilienceTracer.record({
    event: "document_export",
    outcome: "success",
    durationMs: elapsedMilliseconds(startedAt),
    renderKind: document.kind,
    coveragePercent: document.report.coveragePercent,
    fallbackCount: document.report.fallbackCount
  });
}

async function serveClient(pathname: string, response: ServerResponse): Promise<void> {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(clientDirectory, requestedPath);
  const filePath = candidate.startsWith(`${clientDirectory}${path.sep}`)
    ? candidate
    : path.join(clientDirectory, "index.html");

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
      "Content-Type": contentType(filePath)
    });
    response.end(content);
  } catch {
    try {
      const fallback = await readFile(path.join(clientDirectory, "index.html"));
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(fallback);
    } catch {
      sendJson(response, 503, { error: "Client build not found. Run npm run build first." });
    }
  }
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp"
  } as Record<string, string>)[extension] || "application/octet-stream";
}
