import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import {
  buildDocumentDeliveryPlan,
  deliverDraftDocument,
  deliverVerifiedDocument,
  DocumentRenderError,
  type RenderedDocument
} from "../adapters/document_delivery_adapter";
import { compileWebFormInspection } from "../adapters/web_form_compiler";
import {
  inspectRemoteWebForm,
  WebFormProviderThrottleError,
  WebFormResourceLimitError
} from "../adapters/web_form_browser";
import {
  PlaywrightWebFormBrowserBoundary,
  WebFormBrowserSessionError
} from "../adapters/web_form_browser_session";
import { buildWebFormDeliveryPlan } from "../adapters/web_form_delivery_adapter";
import { assessWebFormProviderContract } from "../adapters/web_form_contract";
import { WebFormFillError } from "../adapters/web_form_filler";
import { prepareWebFormUrl, WebFormUrlPolicyError } from "../adapters/web_form_url_policy";
import { AnswerValidationError } from "../domain/answers";
import { isWebFormDefinition, listFormFields } from "../domain/form_definition";
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
  webFormAccessSchema,
  webFormPreparationSchema,
  verificationActionSchema,
  type FormSession,
  type MemoryVault,
  type WebFormFallbackReason
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
import {
  redactOperationalDiagnostic,
  WebFormOperationalTelemetry
} from "./web_form_telemetry";

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
const webFormSessionRequestSchema = z.object({
  url: z.string().trim().min(1).max(4_096),
  access: webFormAccessSchema.default("public")
});
const prepareWebFormBrowserRequestSchema = z.object({
  consent: z.literal(true),
  sessionVersion: z.number().int().nonnegative()
});
const submitWebFormBrowserRequestSchema = z.object({
  browserSessionId: z.string().uuid(),
  sessionVersion: z.number().int().nonnegative()
});
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
const webFormOperationalTelemetry = new WebFormOperationalTelemetry(config.workDir);
const webFormBrowserBoundary = new PlaywrightWebFormBrowserBoundary(null, {
  actionTimeoutMs: config.webFormActionTimeoutMs,
  navigationTimeoutMs: config.webFormInspectionTimeoutMs,
  sessionTtlMs: config.webFormSessionTtlMs,
  maxConcurrentSessions: config.webFormMaxConcurrentSessions,
  maxRequests: config.webFormMaxRequests
});
const publicDemoRateLimiter = new PublicDemoRateLimiter();
const visitorStates = new VisitorStateRegistry({
  publicDemo: config.publicDemo,
  localMemoryVault: config.publicDemo ? createEmptyMemoryVault() : memoryVaultStore.load(),
  onDiscard(state) {
    void state.webForm?.browserSession?.dispose();
  }
});

const server = createServer((request, response) => {
  void routeRequest(request, response).catch((error: unknown) => {
    const normalized = normalizeHttpError(error);
    if (normalized.status === 500 || normalized.status === 502) {
      console.error(redactOperationalDiagnostic(normalized.logMessage));
    }
    sendJson(response, normalized.status, { error: normalized.message });
  });
});

server.listen(config.port, config.host, () => {
  console.log(`VocaForm API listening at http://${config.host}:${config.port}`);
  console.log(`OpenAI API key: ${config.openAiApiKey ? "configured" : "not configured"}`);
});
server.on("close", () => void webFormBrowserBoundary.dispose());

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
    await discardWebFormBrowser(state);
    state.session = null;
    state.sessionSource = null;
    state.webForm = null;
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
    await discardWebFormBrowser(state);
    state.session = createFormSession(state.compilation.form);
    state.sessionSource = state.compilationSource?.compilationId === state.compilation.id
      ? state.compilationSource.document
      : null;
    state.webForm = null;
    state.semanticVerification = null;
    state.interviewToolExecutor.reset();
    sendJson(response, 201, buildSessionView(state, state.session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/web-form") {
    enforcePublicModelLimit("inspect", visitor.id, request, response);
    const body = webFormSessionRequestSchema.parse(await readJsonBody(request));
    const prepared = prepareWebFormUrl(body.url);
    const inspectionStartedAt = performance.now();
    let inspection;
    try {
      inspection = await inspectRemoteWebForm(prepared.url, {
        timeoutMs: config.webFormInspectionTimeoutMs,
        actionTimeoutMs: config.webFormActionTimeoutMs,
        maxRequests: config.webFormMaxRequests,
        maxConcurrentInspections: config.webFormMaxConcurrentSessions
      });
    } catch (error) {
      webFormOperationalTelemetry.record({
        event: "inspection",
        provider: prepared.provider,
        outcome: "error",
        durationMs: elapsedMilliseconds(inspectionStartedAt),
        failureCode: webFormFailureCode(error)
      });
      if (error instanceof WebFormProviderThrottleError) {
        throw new HttpError(429, error.message);
      }
      if (error instanceof WebFormResourceLimitError) {
        throw new HttpError(503, error.message);
      }
      const message = error instanceof Error ? error.message : "The public form could not be inspected.";
      if (/executable doesn.t exist|browser.*not found/i.test(message)) {
        throw new HttpError(503, "Web-form inspection is unavailable because Chromium is not installed on this server.");
      }
      if (/timeout|waiting for locator|waiting for selector/i.test(message)) {
        throw new HttpError(
          422,
          "VocaForm could not find an anonymous responder page. Signed-in forms, quizzes, and CAPTCHA-protected forms are out of scope."
        );
      }
      if (/net::|name_not_resolved|connection_refused/i.test(message)) {
        throw new HttpError(502, "The provider form could not be reached. Check the public responder link and try again.");
      }
      throw error;
    }
    const providerContract = assessWebFormProviderContract(inspection);
    const providerDriftDetected = providerContract.driftReasons.length > 0;
    let compiled;
    try {
      compiled = compileWebFormInspection(inspection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The inspected form could not be prepared.";
      throw new HttpError(422, message);
    }
    await discardWebFormBrowser(state);
    state.session = createFormSession(compiled.form);
    state.sessionSource = null;
    state.webForm = {
      access: body.access,
      handoffUrl: prepared.url.href,
      warnings: body.access === "external"
        ? [
            ...compiled.warnings,
            ...(providerDriftDetected ? [providerDriftWarning()] : []),
            "Sign in only on the provider page. VocaForm cannot access that browser session, so reviewed answers use a manual copy hand-off."
          ]
        : [
            ...compiled.warnings,
            ...(providerDriftDetected ? [providerDriftWarning()] : [])
          ],
      nativePreparationFallbackReason: body.access === "external"
        ? null
        : !config.webFormNativePreparation
          ? "native_preparation_disabled"
          : providerDriftDetected
            ? "provider_drift"
            : null,
      preparation: webFormPreparationSchema.parse({ status: "not_started" }),
      browserSession: null
    };
    state.compilation = null;
    state.compilationSource = null;
    state.semanticVerification = null;
    state.interviewToolExecutor.reset();
    webFormOperationalTelemetry.record({
      event: "inspection",
      provider: inspection.provider,
      outcome: providerDriftDetected ? "fallback" : "success",
      durationMs: elapsedMilliseconds(inspectionStartedAt),
      questionCount: inspection.metrics.questionCount,
      unsupportedControlCount: compiled.blockedFieldIds.length,
      labelCoveragePercent: inspection.metrics.labelCoveragePercent,
      recognizedTypeCoveragePercent: inspection.metrics.recognizedTypeCoveragePercent,
      providerIdCoveragePercent: inspection.metrics.providerIdCoveragePercent,
      usableLocatorCoveragePercent: inspection.metrics.usableLocatorCoveragePercent,
      fallbackReason: providerDriftDetected ? "provider_drift" : null,
      failureCode: providerDriftDetected ? "contract_drift" : null
    });
    const initialDeliveryPlan = buildWebFormDeliveryPlan(state.session, {
      nativePreparationAllowed: body.access === "public" && config.webFormNativePreparation,
      runtimeFallbackReason: state.webForm.nativePreparationFallbackReason
    });
    webFormOperationalTelemetry.record({
      event: "delivery_decision",
      provider: inspection.provider,
      outcome: initialDeliveryPlan.mode === "browser_handoff" ? "success" : "fallback",
      questionCount: listFormFields(state.session.form).length,
      unsupportedControlCount: initialDeliveryPlan.blockedFieldIds.length,
      fallbackReason: initialDeliveryPlan.fallbackReason
    });
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

  if (method === "POST" && url.pathname === "/api/web-form/browser/prepare") {
    enforcePublicModelLimit("prepare", visitor.id, request, response);
    const body = prepareWebFormBrowserRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    if (!isWebFormDefinition(session.form) || !state.webForm) {
      throw new HttpError(422, "Only an active public web form can be prepared in the isolated browser.");
    }
    const deliveryPlan = buildWebFormDeliveryPlan(session, {
      nativePreparationAllowed: state.webForm.access === "public" && config.webFormNativePreparation,
      runtimeFallbackReason: state.webForm.nativePreparationFallbackReason
    });
    if (deliveryPlan.mode !== "browser_handoff") {
      throw new HttpError(
        422,
        "This form needs the guided manual hand-off because its full deterministic control flow is not available."
      );
    }
    const deterministic = verifySession(session, new Date(), {
      approvedMemoryClaimIds: approvedMemoryClaimIds(state)
    });
    const unresolvedBlockers = deterministic.issues.filter(
      (issue) => issue.severity === "blocker" && !issue.resolved
    );
    if (unresolvedBlockers.length > 0) {
      throw new HttpError(422, "Resolve every blocking answer finding before transmitting answers to the provider.");
    }

    await state.webForm.browserSession?.dispose();
    state.webForm.browserSession = null;
    state.webForm.preparation = webFormPreparationSchema.parse({ status: "not_started" });
    const preparationStartedAt = performance.now();
    try {
      const browserSession = await webFormBrowserBoundary.prepare({
        session,
        responderUrl: state.webForm.handoffUrl,
        expiresInMs: config.webFormSessionTtlMs
      });
      state.webForm.browserSession = browserSession;
      state.webForm.preparation = browserSession.view(session);
      const placedControlCount = state.webForm.preparation.status === "awaiting_user_submit"
        ? state.webForm.preparation.placedControls.length
        : 0;
      webFormOperationalTelemetry.record({
        event: "preparation",
        provider: session.form.source.provider,
        outcome: "success",
        durationMs: elapsedMilliseconds(preparationStartedAt),
        placedControlCount,
        verifiedControlCount: placedControlCount
      });
    } catch (error) {
      state.webForm.preparation = preparationFailure(error);
      const fallbackReason = fallbackReasonForRecovery(state.webForm.preparation.reason);
      if (shouldPersistNativeFallback(fallbackReason)) {
        state.webForm.nativePreparationFallbackReason = fallbackReason;
        state.webForm.warnings = [...new Set([...state.webForm.warnings, providerFallbackWarning(fallbackReason)])];
      }
      webFormOperationalTelemetry.record({
        event: "preparation",
        provider: session.form.source.provider,
        outcome: "fallback",
        durationMs: elapsedMilliseconds(preparationStartedAt),
        fallbackReason,
        failureCode: webFormFailureCode(error)
      });
    }
    sendJson(response, 200, buildSessionView(state, session));
    return;
  }

  if (method === "GET" && url.pathname === "/api/web-form/browser/screenshot") {
    const session = requireCurrentSession(state);
    const webForm = state.webForm;
    const browserSession = webForm?.browserSession;
    if (!isWebFormDefinition(session.form) || !webForm || !browserSession) {
      throw new HttpError(404, "No prepared provider view is available.");
    }
    try {
      sendPng(response, await browserSession.screenshot(session));
    } catch (error) {
      webForm.preparation = browserSession.view(session);
      const message = error instanceof Error ? error.message : "The prepared provider view is unavailable.";
      throw new HttpError(410, message);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/web-form/browser/submit") {
    enforcePublicModelLimit("submit", visitor.id, request, response);
    const body = submitWebFormBrowserRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    const browserSession = state.webForm?.browserSession;
    if (!isWebFormDefinition(session.form) || !state.webForm || !browserSession) {
      throw new HttpError(404, "No prepared provider form is awaiting your Submit action.");
    }
    const preparation = browserSession.view(session);
    if (preparation.status !== "awaiting_user_submit"
      || preparation.browserSessionId !== body.browserSessionId) {
      throw new HttpError(409, "That prepared provider form is no longer current. Prepare a fresh copy.");
    }
    const submissionStartedAt = performance.now();
    try {
      state.webForm.preparation = await browserSession.submit(session);
    } catch (error) {
      state.webForm.preparation = browserSession.view(session);
      if (state.webForm.preparation.status !== "recoverable") throw error;
    }
    const submissionPreparation = state.webForm.preparation;
    if (submissionPreparation.status === "recoverable") {
      const fallbackReason = fallbackReasonForRecovery(submissionPreparation.reason);
      if (shouldPersistNativeFallback(fallbackReason)) {
        state.webForm.nativePreparationFallbackReason = fallbackReason;
        state.webForm.warnings = [...new Set([...state.webForm.warnings, providerFallbackWarning(fallbackReason)])];
      }
    }
    webFormOperationalTelemetry.record({
      event: "submission",
      provider: session.form.source.provider,
      outcome: submissionPreparation.status === "submitted"
        ? "success"
        : submissionPreparation.status === "submission_uncertain" ? "uncertain" : "fallback",
      durationMs: elapsedMilliseconds(submissionStartedAt),
      placedControlCount: "placedControlCount" in submissionPreparation
        ? submissionPreparation.placedControlCount
        : null,
      verifiedControlCount: "placedControlCount" in submissionPreparation
        ? submissionPreparation.placedControlCount
        : null,
      fallbackReason: submissionPreparation.status === "recoverable"
        ? fallbackReasonForRecovery(submissionPreparation.reason)
        : null,
      failureCode: submissionPreparation.status === "submitted" ? null : "interrupted"
    });
    sendJson(response, 200, buildSessionView(state, session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/fixture") {
    const body = fixtureRequestSchema.parse(await readJsonBody(request));
    const [form, source] = await Promise.all([
      loadFixture(body.fixtureId),
      loadFixtureSource(body.fixtureId)
    ]);
    await discardWebFormBrowser(state);
    state.session = createFormSession(form);
    state.sessionSource = source;
    state.webForm = null;
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
    await interruptWebFormBrowserForAnswerChange(state);
    state.session = saveTextAnswer(session, body.fieldId, body.value);
    state.semanticVerification = null;
    sendJson(response, 200, buildSessionView(state, state.session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/skip") {
    const body = skipRequestSchema.parse(await readJsonBody(request));
    const session = requireCurrentSession(state, body.sessionVersion);
    await interruptWebFormBrowserForAnswerChange(state);
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
    if (resolution.session.version !== session.version) {
      await interruptWebFormBrowserForAnswerChange(state);
    }
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
    await interruptWebFormBrowserForAnswerChange(state);
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
    if (execution.session.version !== session.version) {
      await interruptWebFormBrowserForAnswerChange(state);
      state.semanticVerification = null;
    }
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
    await discardWebFormBrowser(state);
    state.session = null;
    state.sessionSource = null;
    state.webForm = null;
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
    if (isWebFormDefinition(session.form)) {
      throw new HttpError(422, "Web-form interviews use the guided hand-off and do not create a document export.");
    }
    const startedAt = performance.now();
    try {
      const document = deliverDraftDocument(session);
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
    if (isWebFormDefinition(session.form)) {
      throw new HttpError(422, "VocaForm does not fill or submit provider forms in the public interview MVP.");
    }
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
      const document = await deliverVerifiedDocument(session, state.sessionSource);
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
  if (state.webForm?.browserSession) {
    state.webForm.preparation = state.webForm.browserSession.view(session);
  }
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
    deliveryPlan: isWebFormDefinition(session.form)
      ? buildWebFormDeliveryPlan(session, {
          nativePreparationAllowed: state.webForm?.access !== "external" && config.webFormNativePreparation,
          runtimeFallbackReason: state.webForm?.nativePreparationFallbackReason ?? null
        })
      : buildDocumentDeliveryPlan(session, state.sessionSource),
    webForm: isWebFormDefinition(session.form) && state.webForm ? {
      access: state.webForm.access,
      handoffUrl: state.webForm.handoffUrl,
      warnings: state.webForm.warnings,
      preparation: state.webForm.preparation
    } : null
  };
}

async function discardWebFormBrowser(state: VisitorState): Promise<void> {
  await state.webForm?.browserSession?.dispose();
  if (state.webForm) state.webForm.browserSession = null;
}

async function interruptWebFormBrowserForAnswerChange(state: VisitorState): Promise<void> {
  const browserSession = state.webForm?.browserSession;
  if (!browserSession) return;
  await browserSession.interrupt(
    "session_changed",
    "The canonical answers changed after the provider form was prepared. Prepare it again from the current answers."
  );
  if (state.session && state.webForm) {
    state.webForm.preparation = browserSession.view(state.session);
  }
}

function preparationFailure(error: unknown): Extract<
  NonNullable<SessionView["webForm"]>["preparation"],
  { status: "recoverable" }
> {
  const reason = error instanceof WebFormBrowserSessionError
    ? error.code
    : error instanceof WebFormFillError
      ? error.code === "verification_failed" ? "verification_failed" : "provider_changed"
      : "interrupted";
  const message = error instanceof Error
    ? error.message
    : "The isolated provider session could not be prepared. Try again or use the manual hand-off.";
  return webFormPreparationSchema.parse({
    status: "recoverable",
    reason,
    message,
    retryAllowed: true
  }) as Extract<NonNullable<SessionView["webForm"]>["preparation"], { status: "recoverable" }>;
}

function fallbackReasonForRecovery(
  reason: Extract<
    NonNullable<SessionView["webForm"]>["preparation"],
    { status: "recoverable" }
  >["reason"]
): WebFormFallbackReason {
  const reasons: Record<typeof reason, WebFormFallbackReason> = {
    expired: "expired_session",
    interrupted: "interrupted",
    session_changed: "stale_answers",
    provider_changed: "provider_drift",
    verification_failed: "verification_failed",
    provider_throttled: "provider_throttled",
    resource_limited: "resource_limited"
  };
  return reasons[reason];
}

function shouldPersistNativeFallback(reason: WebFormFallbackReason): boolean {
  return [
    "provider_drift",
    "verification_failed",
    "provider_throttled",
    "resource_limited"
  ].includes(reason);
}

function providerDriftWarning(): string {
  return "The provider contract did not meet the confidence required for native preparation. The reviewed manual answer list remains available.";
}

function providerFallbackWarning(reason: WebFormFallbackReason): string {
  if (reason === "provider_throttled") {
    return "The provider throttled the isolated browser. Continue with the reviewed manual answer list or re-inspect later.";
  }
  if (reason === "resource_limited") {
    return "The provider page exceeded the isolated browser limits. Continue with the reviewed manual answer list.";
  }
  if (reason === "verification_failed") {
    return "A provider control could not be re-verified. No Submit action occurred; continue with the reviewed manual answer list.";
  }
  return providerDriftWarning();
}

function webFormFailureCode(
  error: unknown
): "url_policy" | "browser_unavailable" | "network" | "timeout" | "contract_drift"
  | "provider_throttled" | "resource_limited" | "verification" | "interrupted" | "unknown" {
  if (error instanceof WebFormProviderThrottleError
    || (error instanceof WebFormBrowserSessionError && error.code === "provider_throttled")) {
    return "provider_throttled";
  }
  if (error instanceof WebFormResourceLimitError
    || (error instanceof WebFormBrowserSessionError && error.code === "resource_limited")) {
    return "resource_limited";
  }
  if (error instanceof WebFormUrlPolicyError) return "url_policy";
  if (error instanceof WebFormFillError) return "verification";
  if (error instanceof WebFormBrowserSessionError && error.code === "provider_changed") {
    return "contract_drift";
  }
  const message = error instanceof Error ? error.message : "";
  if (/executable doesn.t exist|browser.*not found/i.test(message)) return "browser_unavailable";
  if (/timeout|waiting for locator|waiting for selector/i.test(message)) return "timeout";
  if (/net::|name_not_resolved|connection_refused/i.test(message)) return "network";
  if (error instanceof WebFormBrowserSessionError) return "interrupted";
  return "unknown";
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
    "This public demo has reached its temporary request limit. Continue with the reviewed manual path or try again later.");
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

function sendPng(response: ServerResponse, bytes: Buffer): void {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "image/png",
    "Content-Length": bytes.length
  });
  response.end(bytes);
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
  if (error instanceof WebFormUrlPolicyError) {
    return { status: 400, message: error.message, logMessage: error.message };
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
