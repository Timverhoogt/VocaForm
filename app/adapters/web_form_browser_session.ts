import { createHash } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";
import { isWebFormDefinition, listFormFields } from "../domain/form_definition";
import {
  answerFingerprint,
  isFieldApplicable
} from "../domain/session";
import {
  webFormPreparationSchema,
  type FormSession,
  type WebFormPreparation,
  type WebFormProvider
} from "../domain/schemas";
import { compileWebFormInspection } from "./web_form_compiler";
import {
  decideWebFormRequest,
  inspectWebFormPage
} from "./web_form_browser";
import { assessWebFormProviderContract } from "./web_form_contract";
import {
  fillAndVerifyWebFormPage,
  findProviderSubmitButton,
  verifyPlacedWebFormControls,
  WebFormFillError
} from "./web_form_filler";
import {
  isProviderAssetUrlAllowed,
  prepareWebFormUrl
} from "./web_form_url_policy";

export const WEB_FORM_BROWSER_SESSION_TTL_MS = 15 * 60 * 1_000;

type WebFormRecoveryReason =
  | "expired"
  | "interrupted"
  | "session_changed"
  | "provider_changed"
  | "verification_failed"
  | "provider_throttled"
  | "resource_limited";

interface BrowserResourceBudget {
  count: number;
  exceeded: boolean;
  providerThrottled: boolean;
}

export interface PrepareWebFormBrowserInput {
  session: FormSession;
  responderUrl: string;
  now?: Date;
  expiresInMs?: number;
}

export interface WebFormBrowserPreparationRuntime {
  view(session: FormSession, now?: Date): WebFormPreparation;
  screenshot(session: FormSession, now?: Date): Promise<Buffer>;
  submit(session: FormSession, now?: Date): Promise<WebFormPreparation>;
  interrupt(
    reason: Exclude<WebFormRecoveryReason, "expired">,
    message: string
  ): Promise<void>;
  dispose(): Promise<void>;
}

export interface WebFormBrowserSessionBoundary {
  prepare(input: PrepareWebFormBrowserInput): Promise<WebFormBrowserPreparationRuntime>;
  dispose(): Promise<void>;
}

export class WebFormBrowserSessionError extends Error {
  constructor(
    readonly code: WebFormRecoveryReason,
    message: string
  ) {
    super(message);
  }
}

export interface PlaywrightWebFormBrowserBoundaryOptions {
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  sessionTtlMs?: number;
  submissionConfirmationTimeoutMs?: number;
  maxConcurrentSessions?: number;
  maxRequests?: number;
}

export class PlaywrightWebFormBrowserBoundary implements WebFormBrowserSessionBoundary {
  private browserPromise: Promise<Browser> | null = null;
  private activeSessions = 0;

  constructor(
    private readonly suppliedBrowser: Browser | null = null,
    private readonly options: PlaywrightWebFormBrowserBoundaryOptions = {}
  ) {}

  async prepare(input: PrepareWebFormBrowserInput): Promise<WebFormBrowserPreparationRuntime> {
    const session = input.session;
    if (!isWebFormDefinition(session.form)) {
      throw new WebFormBrowserSessionError("verification_failed", "Native preparation requires a web-form session.");
    }
    const preparedUrl = prepareWebFormUrl(input.responderUrl);
    if (preparedUrl.provider !== session.form.source.provider) {
      throw new WebFormBrowserSessionError("provider_changed", "The responder URL no longer matches this form provider.");
    }

    if (this.activeSessions >= (this.options.maxConcurrentSessions ?? 4)) {
      throw new WebFormBrowserSessionError(
        "resource_limited",
        "Native preparation capacity is temporarily full. Use the reviewed manual hand-off or try again later."
      );
    }
    this.activeSessions += 1;
    let sessionSlotReleased = false;
    const releaseSessionSlot = () => {
      if (sessionSlotReleased) return;
      sessionSlotReleased = true;
      this.activeSessions = Math.max(0, this.activeSessions - 1);
    };

    let context: BrowserContext | null = null;
    let submissionAllowed = false;
    try {
      const browser = this.suppliedBrowser ?? await (this.browserPromise ??= chromium.launch({ headless: true }));
      context = await browser.newContext({
        acceptDownloads: false,
        javaScriptEnabled: true,
        locale: session.form.locale,
        permissions: [],
        serviceWorkers: "block",
        viewport: { width: 1280, height: 900 }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(this.options.actionTimeoutMs ?? 10_000);
      page.setDefaultNavigationTimeout(this.options.navigationTimeoutMs ?? 30_000);
      page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
      context.on("page", (openedPage) => {
        if (openedPage !== page) void openedPage.close().catch(() => undefined);
      });
      const requestBudget: BrowserResourceBudget = {
        count: 0,
        exceeded: false,
        providerThrottled: false
      };
      page.on("response", (response) => {
        if (response.status() === 429) requestBudget.providerThrottled = true;
      });
      await installSubmissionBoundary(page);
      await page.route("**/*", async (route) => {
        requestBudget.count += 1;
        if (requestBudget.count > (this.options.maxRequests ?? 300)) {
          requestBudget.exceeded = true;
          await route.abort("blockedbyclient");
          return;
        }
        if (["font", "media"].includes(route.request().resourceType())) {
          await route.abort("blockedbyclient");
          return;
        }
        const request = route.request();
        const decision = decidePreparationRequest({
          provider: preparedUrl.provider,
          method: request.method(),
          url: request.url(),
          mainFrameNavigation: request.isNavigationRequest() && request.frame() === page.mainFrame(),
          submissionAllowed
        });
        if (decision.action === "abort") await route.abort("blockedbyclient");
        else await route.continue(decision.sanitizedUrl ? { url: decision.sanitizedUrl } : undefined);
      });
      const response = await page.goto(preparedUrl.url.href, {
        waitUntil: "domcontentloaded",
        timeout: this.options.navigationTimeoutMs ?? 30_000
      });
      if (response?.status() === 429 || requestBudget.providerThrottled) {
        throw new WebFormBrowserSessionError(
          "provider_throttled",
          "The provider is throttling native preparation. Use the reviewed manual hand-off or try again later."
        );
      }
      if (requestBudget.exceeded) {
        throw new WebFormBrowserSessionError(
          "resource_limited",
          "The provider page exceeded the isolated browser resource budget. Use the reviewed manual hand-off."
        );
      }
      await waitForProviderBoundary(
        page,
        preparedUrl.provider,
        this.options.navigationTimeoutMs ?? 30_000
      );
      await verifyCurrentSource(page, session);
      await findProviderSubmitButton(page, preparedUrl.provider);

      const preparedAt = input.now ?? new Date();
      const placedControls = await fillAndVerifyWebFormPage(page, session, preparedAt);
      const screenshot = await page.screenshot({ type: "png", fullPage: false });
      return createPreparedWebFormRuntime({
        context,
        page,
        provider: preparedUrl.provider,
        session,
        placedControls,
        preparedAt,
        expiresInMs: Math.min(
          input.expiresInMs ?? this.options.sessionTtlMs ?? WEB_FORM_BROWSER_SESSION_TTL_MS,
          this.options.sessionTtlMs ?? WEB_FORM_BROWSER_SESSION_TTL_MS
        ),
        screenshot: Buffer.from(screenshot),
        actionTimeoutMs: this.options.actionTimeoutMs ?? 10_000,
        submissionConfirmationTimeoutMs: this.options.submissionConfirmationTimeoutMs ?? 8_000,
        resourceBudget: requestBudget,
        onDisposed: releaseSessionSlot,
        setSubmissionAllowed(value) {
          submissionAllowed = value;
        }
      });
    } catch (error) {
      await context?.close().catch(() => undefined);
      releaseSessionSlot();
      if (error instanceof WebFormBrowserSessionError || error instanceof WebFormFillError) throw error;
      const message = error instanceof Error ? error.message : "The native provider form could not be prepared.";
      throw new WebFormBrowserSessionError("interrupted", message);
    }
  }

  async dispose(): Promise<void> {
    if (!this.suppliedBrowser && this.browserPromise) {
      const browser = await this.browserPromise.catch(() => null);
      await browser?.close().catch(() => undefined);
      this.browserPromise = null;
    }
    this.activeSessions = 0;
  }
}

export interface PreparedWebFormRuntimeOptions {
  context: BrowserContext;
  page: Page;
  provider: WebFormProvider;
  session: FormSession;
  placedControls: Extract<WebFormPreparation, { status: "awaiting_user_submit" }>["placedControls"];
  preparedAt: Date;
  expiresInMs: number;
  screenshot: Buffer;
  actionTimeoutMs?: number;
  submissionConfirmationTimeoutMs?: number;
  resourceBudget?: BrowserResourceBudget;
  onDisposed?: () => void;
  setSubmissionAllowed: (value: boolean) => void;
}

export function createPreparedWebFormRuntime(
  options: PreparedWebFormRuntimeOptions
): WebFormBrowserPreparationRuntime {
  return new PlaywrightWebFormPreparation(options);
}

class PlaywrightWebFormPreparation implements WebFormBrowserPreparationRuntime {
  private state: WebFormPreparation;
  private latestScreenshot: Buffer;
  private closed = false;

  constructor(private readonly options: PreparedWebFormRuntimeOptions) {
    const binding = canonicalBinding(options.session);
    this.latestScreenshot = options.screenshot;
    this.state = webFormPreparationSchema.parse({
      status: "awaiting_user_submit",
      ...binding,
      preparedAt: options.preparedAt.toISOString(),
      expiresAt: new Date(options.preparedAt.getTime() + options.expiresInMs).toISOString(),
      placedControls: options.placedControls,
      screenshotVersion: 1
    });
  }

  view(session: FormSession, now = new Date()): WebFormPreparation {
    if (this.state.status !== "awaiting_user_submit") return this.state;
    if (this.options.resourceBudget?.providerThrottled) {
      this.toRecoverable(
        "provider_throttled",
        "The provider throttled the isolated session. Use the reviewed manual hand-off or prepare a fresh copy later."
      );
      return this.state;
    }
    if (this.options.resourceBudget?.exceeded) {
      this.toRecoverable(
        "resource_limited",
        "The provider page exceeded the isolated browser resource budget. Use the reviewed manual hand-off."
      );
      return this.state;
    }
    if (now.getTime() >= Date.parse(this.state.expiresAt)) {
      this.toRecoverable(
        "expired",
        "The isolated provider session expired before submission. Prepare a fresh copy and review it again."
      );
      return this.state;
    }
    if (!matchesCanonicalBinding(this.state, session)) {
      this.toRecoverable(
        "session_changed",
        "The canonical answers changed after this provider form was prepared. Prepare it again from the current answers."
      );
    }
    return this.state;
  }

  async screenshot(session: FormSession, now = new Date()): Promise<Buffer> {
    const state = this.view(session, now);
    if (state.status === "submitted" || state.status === "submission_uncertain") return this.latestScreenshot;
    if (state.status !== "awaiting_user_submit") {
      if (state.status === "recoverable") {
        throw new WebFormBrowserSessionError(state.reason, state.message);
      }
      throw new WebFormBrowserSessionError("interrupted", "No provider form has been prepared.");
    }
    try {
      this.latestScreenshot = Buffer.from(await this.options.page.screenshot({ type: "png", fullPage: false }));
      this.state = webFormPreparationSchema.parse({
        ...state,
        screenshotVersion: state.screenshotVersion + 1
      });
      return this.latestScreenshot;
    } catch {
      await this.interrupt(
        "interrupted",
        "The isolated provider session was interrupted. Prepare a fresh copy to continue."
      );
      throw new WebFormBrowserSessionError("interrupted", "The isolated provider session was interrupted.");
    }
  }

  async submit(session: FormSession, now = new Date()): Promise<WebFormPreparation> {
    const state = this.view(session, now);
    if (state.status !== "awaiting_user_submit") {
      const message = state.status === "recoverable"
        ? state.message
        : "This provider form has already received its one user-authorized Submit action.";
      throw new WebFormBrowserSessionError(
        state.status === "recoverable" ? state.reason : "interrupted",
        message
      );
    }

    let submitActionConsumed = false;
    try {
      await verifyPlacedWebFormControls(
        this.options.page,
        session,
        state.placedControls,
        now
      );
      const button = await findProviderSubmitButton(this.options.page, this.options.provider);
      const beforeSubmitUrl = this.options.page.url();
      this.options.setSubmissionAllowed(true);
      await this.options.page.evaluate("globalThis.__vocaformSubmitAllowed = true");
      submitActionConsumed = true;
      await button.click({
        noWaitAfter: true,
        timeout: this.options.actionTimeoutMs ?? 10_000
      });
      const confirmed = await waitForProviderSubmissionConfirmation(
        this.options.page,
        this.options.provider,
        beforeSubmitUrl,
        this.options.submissionConfirmationTimeoutMs ?? 8_000
      );
      if (!confirmed || this.options.resourceBudget?.providerThrottled) {
        throw new Error("The provider did not expose a deterministic submission confirmation.");
      }
      this.options.setSubmissionAllowed(false);
      await this.options.page.evaluate("globalThis.__vocaformSubmitAllowed = false").catch(() => undefined);
      this.latestScreenshot = Buffer.from(await this.options.page.screenshot({ type: "png", fullPage: false }));
      this.state = webFormPreparationSchema.parse({
        status: "submitted",
        browserSessionId: state.browserSessionId,
        canonicalSessionId: state.canonicalSessionId,
        canonicalSessionVersion: state.canonicalSessionVersion,
        canonicalSessionFingerprint: state.canonicalSessionFingerprint,
        sourceUrlFingerprint: state.sourceUrlFingerprint,
        sourceRevisionFingerprint: state.sourceRevisionFingerprint,
        submittedAt: now.toISOString(),
        placedControlCount: state.placedControls.length,
        screenshotVersion: state.screenshotVersion + 1
      });
      await this.closeResources();
      return this.state;
    } catch (error) {
      this.options.setSubmissionAllowed(false);
      if (submitActionConsumed) {
        this.state = webFormPreparationSchema.parse({
          status: "submission_uncertain",
          browserSessionId: state.browserSessionId,
          canonicalSessionId: state.canonicalSessionId,
          canonicalSessionVersion: state.canonicalSessionVersion,
          canonicalSessionFingerprint: state.canonicalSessionFingerprint,
          sourceUrlFingerprint: state.sourceUrlFingerprint,
          sourceRevisionFingerprint: state.sourceRevisionFingerprint,
          attemptedAt: now.toISOString(),
          placedControlCount: state.placedControls.length,
          message: "The user-authorized Submit click began, but the provider result could not be confirmed. To prevent a duplicate response, VocaForm will not retry it.",
          screenshotVersion: state.screenshotVersion
        });
        await this.closeResources();
        return this.state;
      }
      await this.interrupt(
        error instanceof WebFormFillError ? "verification_failed" : "interrupted",
        error instanceof WebFormFillError
          ? "A provider control changed after preparation. Review the canonical answers and prepare a fresh copy."
          : "The provider did not complete the user-authorized Submit action. Prepare a fresh copy or use the manual hand-off."
      );
      if (error instanceof WebFormBrowserSessionError) throw error;
      throw new WebFormBrowserSessionError("interrupted", "The provider Submit action was interrupted.");
    }
  }

  async interrupt(
    reason: Exclude<WebFormRecoveryReason, "expired">,
    message: string
  ): Promise<void> {
    if (this.state.status === "awaiting_user_submit") {
      this.state = webFormPreparationSchema.parse({
        status: "recoverable",
        reason,
        message,
        retryAllowed: true
      });
    }
    await this.closeResources();
  }

  async dispose(): Promise<void> {
    await this.closeResources();
  }

  private toRecoverable(
    reason: WebFormRecoveryReason,
    message: string
  ): void {
    this.state = webFormPreparationSchema.parse({
      status: "recoverable",
      reason,
      message,
      retryAllowed: true
    });
    void this.closeResources();
  }

  private async closeResources(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.options.context.close().catch(() => undefined);
    this.options.onDisposed?.();
  }
}

export function canonicalWebFormSessionFingerprint(session: FormSession): string {
  if (!isWebFormDefinition(session.form)) {
    throw new WebFormBrowserSessionError("verification_failed", "A document session has no web-form fingerprint.");
  }
  const applicableFields = listFormFields(session.form)
    .filter((field) => isFieldApplicable(session, field))
    .map((field) => field.id)
    .sort();
  return createHash("sha256").update(JSON.stringify({
    sessionId: session.id,
    sessionVersion: session.version,
    sourceRevisionFingerprint: session.form.source.revision.fingerprint,
    sourceUrlFingerprint: session.form.source.urlFingerprint,
    answers: Object.fromEntries(applicableFields.map((fieldId) => [fieldId, answerFingerprint(session, fieldId)]))
  })).digest("hex");
}

export function decidePreparationRequest(input: {
  provider: WebFormProvider;
  method: string;
  url: string;
  mainFrameNavigation: boolean;
  submissionAllowed: boolean;
}): { action: "abort" } | { action: "continue"; sanitizedUrl: string | null } {
  const method = input.method.toUpperCase();
  if (input.submissionAllowed) {
    if (method === "POST" && isProviderAssetUrlAllowed(input.provider, input.url)) {
      return { action: "continue", sanitizedUrl: null };
    }
    if (["GET", "HEAD", "OPTIONS"].includes(method)
      && isProviderAssetUrlAllowed(input.provider, input.url)) {
      return { action: "continue", sanitizedUrl: null };
    }
    return { action: "abort" };
  }
  const decision = decideWebFormRequest(input);
  return decision;
}

export async function verifyCurrentSource(page: Page, session: FormSession): Promise<void> {
  if (!isWebFormDefinition(session.form)) return;
  const finalUrl = prepareWebFormUrl(page.url());
  const actualUrlFingerprint = createHash("sha256").update(finalUrl.url.href).digest("hex");
  if (actualUrlFingerprint !== session.form.source.urlFingerprint) {
    throw new WebFormBrowserSessionError(
      "provider_changed",
      "The provider responder URL changed since inspection. Inspect the form again before transmitting answers."
    );
  }
  const inspection = await inspectWebFormPage(page, session.form.source.provider, {
    provider: session.form.source.provider,
    origin: finalUrl.url.origin,
    urlFingerprint: actualUrlFingerprint,
    queryParametersRemoved: finalUrl.queryParametersRemoved
  });
  const contract = assessWebFormProviderContract(inspection);
  if (!contract.safeForNativePreparation) {
    throw new WebFormBrowserSessionError(
      "provider_changed",
      "The provider page no longer matches the verified markup, control, navigation, and Submit contract. Use the reviewed manual hand-off."
    );
  }
  const current = compileWebFormInspection(inspection);
  if (current.form.source.revision.fingerprint !== session.form.source.revision.fingerprint) {
    throw new WebFormBrowserSessionError(
      "provider_changed",
      "The provider questions changed since inspection. Inspect the form again before transmitting answers."
    );
  }
}

export async function waitForProviderSubmissionConfirmation(
  page: Page,
  provider: WebFormProvider,
  beforeSubmitUrl: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    await page.waitForFunction(
      ({ providerName, initialUrl }) => {
        const common = document.querySelector(
          '[data-vocaform-submission-confirmation], [data-automation-id="thankYouMessage"], '
          + '[data-automation-id="responseConfirmation"]'
        );
        if (common) return true;
        if (providerName === "google_forms" && document.querySelector(
          ".freebirdFormviewerViewResponseConfirmationMessage"
        )) return true;
        const navigated = location.href !== initialUrl;
        const providerFormGone = providerName === "google_forms"
          ? !document.querySelector('form[action*="formResponse"]')
          : !document.querySelector('[data-automation-id="submitButton"]');
        return navigated && providerFormGone;
      },
      { providerName: provider, initialUrl: beforeSubmitUrl },
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

async function installSubmissionBoundary(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      globalThis.__vocaformSubmitAllowed = false;
      window.addEventListener("submit", function (event) {
        if (!globalThis.__vocaformSubmitAllowed) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      const nativeSubmit = HTMLFormElement.prototype.submit;
      const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
      Object.defineProperty(HTMLFormElement.prototype, "submit", {
        configurable: false,
        value: function () {
          if (globalThis.__vocaformSubmitAllowed) return nativeSubmit.call(this);
          return undefined;
        }
      });
      Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
        configurable: false,
        value: function (submitter) {
          if (globalThis.__vocaformSubmitAllowed) return nativeRequestSubmit.call(this, submitter);
          return undefined;
        }
      });
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: false,
        value: function () { return false; }
      });
    `
  });
}

async function waitForProviderBoundary(page: Page, provider: WebFormProvider, timeoutMs: number): Promise<void> {
  const selector = provider === "google_forms"
    ? 'form[action*="formResponse"], [role="heading"][aria-level="1"]'
    : '[data-automation-id="formTitle"], [data-automation-id="questionItem"]';
  await page.waitForSelector(selector, { state: "attached", timeout: timeoutMs });
}

function canonicalBinding(session: FormSession): Omit<
  Extract<WebFormPreparation, { status: "awaiting_user_submit" }>,
  "status" | "preparedAt" | "expiresAt" | "placedControls" | "screenshotVersion"
> {
  if (!isWebFormDefinition(session.form)) {
    throw new WebFormBrowserSessionError("verification_failed", "Native preparation requires a web form.");
  }
  return {
    browserSessionId: crypto.randomUUID(),
    canonicalSessionId: session.id,
    canonicalSessionVersion: session.version,
    canonicalSessionFingerprint: canonicalWebFormSessionFingerprint(session),
    sourceUrlFingerprint: session.form.source.urlFingerprint,
    sourceRevisionFingerprint: session.form.source.revision.fingerprint
  };
}

function matchesCanonicalBinding(
  state: Extract<WebFormPreparation, { status: "awaiting_user_submit" }>,
  session: FormSession
): boolean {
  return state.canonicalSessionId === session.id
    && state.canonicalSessionVersion === session.version
    && state.canonicalSessionFingerprint === canonicalWebFormSessionFingerprint(session)
    && isWebFormDefinition(session.form)
    && state.sourceUrlFingerprint === session.form.source.urlFingerprint
    && state.sourceRevisionFingerprint === session.form.source.revision.fingerprint;
}
