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
  type RenderedDocument,
  type SourceDocument
} from "../adapters/document_renderer";
import { AnswerValidationError } from "../domain/answers";
import { evaluateCompilation, toFormDefinition } from "../domain/compiler";
import {
  buildSessionMemoryContext,
  confirmMemoryClaimForSession,
  correctMemoryClaim,
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
  type SemanticVerificationRun,
  VerificationValidationError
} from "../domain/verification";
import type {
  CompilationResult,
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
import { InterviewToolExecutor, interviewToolRequestSchema } from "./interview_tools";
import { MemoryVaultFileStore } from "./memory_vault_store";
import { buildRealtimeSessionConfig } from "./realtime_session";

const config = getConfig();
const clientDirectory = path.resolve("dist/client");
const jsonBodySchema = z.object({}).passthrough();
const fixtureRequestSchema = z.object({ fixtureId: z.string().min(1) });
const answerRequestSchema = z.object({
  fieldId: z.string().min(1),
  value: z.string().min(1),
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

let currentSession: FormSession | null = null;
let currentCompilation: CompilationResult | null = null;
let currentCompilationSource: { compilationId: string; document: SourceDocument } | null = null;
let currentSessionSource: SourceDocument | null = null;
let formCompiler: OpenAiFormCompiler | null = null;
let finalVerifier: OpenAiFinalVerifier | null = null;
let currentSemanticVerification: SemanticVerificationRun | null = null;
const interviewToolExecutor = new InterviewToolExecutor();
const memoryVaultStore = new MemoryVaultFileStore(config.workDir);
let currentMemoryVault = memoryVaultStore.load();

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

  if (method === "GET" && url.pathname === "/api/health") {
    const payload: HealthPayload = {
      status: "ok",
      version: packageJson.version,
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
    sendJson(response, 200, buildMemoryVaultView(currentMemoryVault));
    return;
  }

  if (method === "GET" && url.pathname === "/api/compilation") {
    if (!currentCompilation) throw new HttpError(404, "No compiled form is available.");
    sendJson(response, 200, currentCompilation);
    return;
  }

  if (method === "POST" && url.pathname === "/api/forms/compile") {
    if (!config.openAiApiKey) {
      throw new HttpError(503, "Add OPENAI_API_KEY to the server environment before uploading a form.");
    }
    let document: Awaited<ReturnType<typeof prepareCompilerDocument>>;
    try {
      document = await prepareCompilerDocument(await readJsonBody(request, 15_000_000), {
        sofficeBin: config.sofficeBin
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : "The uploaded document is invalid.";
      throw new HttpError(400, message);
    }
    formCompiler ??= new OpenAiFormCompiler(config);
    let modelResult;
    try {
      modelResult = await formCompiler.compile(document);
    } catch (error) {
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
    currentCompilation = {
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
    currentCompilationSource = {
      compilationId,
      document: {
        fileName: document.fileName,
        format: document.format === "fixture" ? "text" : document.format,
        bytes: Buffer.from(document.originalBytes)
      }
    };
    currentSession = null;
    currentSessionSource = null;
    currentSemanticVerification = null;
    sendJson(response, 201, currentCompilation);
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/compiled") {
    const body = compiledSessionRequestSchema.parse(await readJsonBody(request));
    if (!currentCompilation || currentCompilation.id !== body.compilationId) {
      throw new HttpError(404, "That compiled form is no longer available.");
    }
    if (!currentCompilation.readiness.ready || !currentCompilation.form) {
      throw new HttpError(422, "Resolve the readiness blockers before starting the interview.");
    }
    currentSession = createFormSession(currentCompilation.form);
    currentSessionSource = currentCompilationSource?.compilationId === currentCompilation.id
      ? currentCompilationSource.document
      : null;
    currentSemanticVerification = null;
    interviewToolExecutor.reset();
    sendJson(response, 201, buildSessionView(currentSession));
    return;
  }

  if (method === "GET" && url.pathname === "/api/session") {
    if (!currentSession) {
      sendJson(response, 404, { error: "No form session is active." });
      return;
    }
    sendJson(response, 200, buildSessionView(currentSession));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/fixture") {
    const body = fixtureRequestSchema.parse(await readJsonBody(request));
    const [form, source] = await Promise.all([
      loadFixture(body.fixtureId),
      loadFixtureSource(body.fixtureId)
    ]);
    currentSession = createFormSession(form);
    currentSessionSource = source;
    currentCompilation = null;
    currentCompilationSource = null;
    currentSemanticVerification = null;
    interviewToolExecutor.reset();
    sendJson(response, 201, buildSessionView(currentSession));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/answer") {
    const body = answerRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(body.sessionVersion);
    currentSession = saveTextAnswer(session, body.fieldId, body.value);
    currentSemanticVerification = null;
    sendJson(response, 200, buildSessionView(currentSession));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/skip") {
    const body = skipRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(body.sessionVersion);
    currentSession = skipAnswer(session, body.fieldId);
    currentSemanticVerification = null;
    sendJson(response, 200, buildSessionView(currentSession));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/verify") {
    const body = verificationRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(body.sessionVersion);
    const deterministic = verifySession(session, new Date(), {
      approvedMemoryClaimIds: approvedMemoryClaimIds()
    });
    if (deterministic.issues.some((issue) => issue.severity === "blocker" && !issue.resolved)) {
      currentSemanticVerification = null;
      sendJson(response, 200, buildSessionView(session));
      return;
    }
    if (!config.openAiApiKey) {
      currentSemanticVerification = null;
      sendJson(response, 200, buildSessionView(session));
      return;
    }

    const expectedSessionId = session.id;
    const expectedVersion = session.version;
    const checkedAt = new Date().toISOString();
    finalVerifier ??= new OpenAiFinalVerifier(config);
    try {
      const result = await finalVerifier.verify(session);
      if (!currentSession || currentSession.id !== expectedSessionId || currentSession.version !== expectedVersion) {
        throw new HttpError(409, "This form changed while verification was running. Run the check again.");
      }
      currentSemanticVerification = {
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
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (!currentSession || currentSession.id !== expectedSessionId || currentSession.version !== expectedVersion) {
        throw new HttpError(409, "This form changed while verification was running. Run the check again.");
      }
      const detail = error instanceof Error ? error.message : "Unknown verifier error.";
      console.error(`Final verification failed: ${detail}`);
      currentSemanticVerification = {
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
    sendJson(response, 200, buildSessionView(session));
    return;
  }

  const verificationResolutionMatch = url.pathname.match(/^\/api\/session\/verification\/issues\/([^/]+)\/resolve$/);
  if (method === "POST" && verificationResolutionMatch) {
    const issueId = decodeURIComponent(verificationResolutionMatch[1] as string);
    const body = verificationResolutionRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(body.sessionVersion);
    const issue = buildSessionView(session).verification.issues.find((candidate) => candidate.id === issueId);
    if (!issue) throw new HttpError(404, "That verification finding is no longer active.");
    const previousRun = currentSemanticVerification;
    const resolution = resolveVerificationIssue(session, issue, body);
    currentSession = resolution.session;
    if (!resolution.answerChanged
      && previousRun?.sessionId === session.id
      && previousRun.sessionVersion === session.version) {
      currentSemanticVerification = { ...previousRun, sessionVersion: currentSession.version };
    } else {
      currentSemanticVerification = null;
    }
    sendJson(response, 200, buildSessionView(currentSession));
    return;
  }

  if (method === "POST" && url.pathname === "/api/memory/remember") {
    const body = rememberAnswerRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(body.sessionVersion);
    const nextVault = rememberSessionAnswer(
      currentMemoryVault,
      session,
      body.fieldId,
      body.subject,
      { channel: "ui" }
    );
    persistMemoryVault(nextVault);
    sendJson(response, 200, buildMemoryMutationResponse());
    return;
  }

  if (method === "POST" && url.pathname === "/api/memory/apply") {
    const body = applyMemoryRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(body.sessionVersion);
    currentSession = confirmMemoryClaimForSession(
      session,
      currentMemoryVault,
      body.fieldId,
      body.claimId,
      { channel: "ui" }
    );
    currentSemanticVerification = null;
    sendJson(response, 200, buildMemoryMutationResponse());
    return;
  }

  const memoryClaimMatch = url.pathname.match(/^\/api\/memory\/claims\/([^/]+)$/);
  if (memoryClaimMatch && method === "PATCH") {
    const claimId = z.string().uuid().parse(decodeURIComponent(memoryClaimMatch[1] as string));
    const body = correctMemoryRequestSchema.parse(await readJsonBody(request));
    persistMemoryVault(correctMemoryClaim(currentMemoryVault, claimId, body.value));
    sendJson(response, 200, buildMemoryMutationResponse());
    return;
  }

  if (memoryClaimMatch && method === "DELETE") {
    const claimId = z.string().uuid().parse(decodeURIComponent(memoryClaimMatch[1] as string));
    persistMemoryVault(forgetMemoryClaim(currentMemoryVault, claimId));
    sendJson(response, 200, buildMemoryMutationResponse());
    return;
  }

  if (method === "POST" && url.pathname === "/api/interview/tool") {
    const body = interviewToolRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession();
    const execution = interviewToolExecutor.execute(body, session, currentMemoryVault);
    if (execution.vault.version !== currentMemoryVault.version) {
      try {
        persistMemoryVault(execution.vault);
      } catch (error) {
        interviewToolExecutor.reset();
        throw error;
      }
    }
    if (execution.session.version !== session.version) currentSemanticVerification = null;
    currentSession = execution.session;
    sendJson(response, 200, {
      output: execution.output,
      view: buildSessionView(currentSession),
      cached: execution.cached
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/realtime/call") {
    if (!config.openAiApiKey) {
      throw new HttpError(503, "Add OPENAI_API_KEY before starting a voice interview.");
    }
    const session = requireCurrentSession();
    const sdp = await readTextBody(request, 200_000);
    if (!sdp.includes("v=0")) throw new HttpError(400, "The WebRTC offer is invalid.");
    const formData = new FormData();
    formData.set("sdp", sdp);
    formData.set("session", JSON.stringify(buildRealtimeSessionConfig(session, config)));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.openAiApiKey}`
    };
    if (config.openAiSafetyIdentifier) {
      headers["OpenAI-Safety-Identifier"] = config.openAiSafetyIdentifier;
    }
    const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers,
      body: formData
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      console.error(`OpenAI Realtime call failed (${upstream.status}).`);
      throw new HttpError(502, "The voice interview could not connect. Please try again.");
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/sdp",
      "Content-Length": Buffer.byteLength(body)
    });
    response.end(body);
    return;
  }

  if (method === "DELETE" && url.pathname === "/api/session") {
    currentSession = null;
    currentSessionSource = null;
    currentSemanticVerification = null;
    interviewToolExecutor.reset();
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (method === "DELETE" && url.pathname === "/api/compilation") {
    currentCompilation = null;
    currentCompilationSource = null;
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (method === "POST" && url.pathname === "/api/export/draft") {
    const session = requireCurrentSession();
    sendDocument(response, renderDraftDocument(session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/export/final") {
    const session = requireCurrentSession();
    const verification = buildFinalVerification(session, {
      approvedMemoryClaimIds: approvedMemoryClaimIds(),
      modelAvailable: Boolean(config.openAiApiKey),
      semanticRun: currentSemanticVerification
    });
    if (!verification.readyForFinalExport) {
      throw new HttpError(422, "Resolve every blocking finding and run final verification before exporting.");
    }
    sendDocument(response, await renderVerifiedDocument(session, currentSessionSource));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }

  await serveClient(url.pathname, response);
}

function buildSessionView(session: FormSession): SessionView {
  return {
    session,
    summary: summarizeSession(session),
    verification: buildFinalVerification(session, {
      approvedMemoryClaimIds: approvedMemoryClaimIds(),
      modelAvailable: Boolean(config.openAiApiKey),
      semanticRun: currentSemanticVerification
    }),
    nextField: nextOpenField(session),
    memory: buildSessionMemoryContext(currentMemoryVault, session),
    exportPlan: buildDocumentExportPlan(session, currentSessionSource)
  };
}

function approvedMemoryClaimIds(): Set<string> {
  return new Set(currentMemoryVault.claims
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

function buildMemoryMutationResponse(): MemoryMutationResponse {
  return {
    memory: buildMemoryVaultView(currentMemoryVault),
    view: currentSession ? buildSessionView(currentSession) : null
  };
}

function persistMemoryVault(vault: MemoryVault): void {
  memoryVaultStore.save(vault);
  currentMemoryVault = vault;
}

function requireCurrentSession(expectedVersion?: number): FormSession {
  if (!currentSession) throw new HttpError(404, "No form session is active.");
  if (expectedVersion !== undefined && currentSession.version !== expectedVersion) {
    throw new HttpError(409, "This form changed in another request. Refresh and try again.");
  }
  return currentSession;
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
