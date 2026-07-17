import { createHash } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Route
} from "@playwright/test";
import { inspectGoogleFormsPage } from "./google_forms_inspector";
import { inspectMicrosoftFormsPage } from "./microsoft_forms_inspector";
import type {
  WebFormInspection,
  WebFormInspectionSource,
  WebFormProvider
} from "./web_form_inspection";
import {
  isProviderAssetUrlAllowed,
  prepareWebFormUrl,
  WebFormUrlPolicyError
} from "./web_form_url_policy";

export interface InspectRemoteWebFormOptions {
  browser?: Browser;
  timeoutMs?: number;
  actionTimeoutMs?: number;
  maxRequests?: number;
  maxConcurrentInspections?: number;
}

export class WebFormProviderThrottleError extends Error {}
export class WebFormResourceLimitError extends Error {}

let activeRemoteInspections = 0;

export interface WebFormRequestPolicyInput {
  provider: WebFormProvider;
  method: string;
  url: string;
  mainFrameNavigation: boolean;
}

export type WebFormRequestPolicyDecision =
  | { action: "abort" }
  | { action: "continue"; sanitizedUrl: string | null };

export async function inspectRemoteWebForm(
  value: string | URL,
  options: InspectRemoteWebFormOptions = {}
): Promise<WebFormInspection> {
  const prepared = prepareWebFormUrl(value);
  const maxConcurrentInspections = options.maxConcurrentInspections ?? 4;
  if (activeRemoteInspections >= maxConcurrentInspections) {
    throw new WebFormResourceLimitError(
      "Web-form inspection capacity is temporarily full. Use the manual form or try again later."
    );
  }
  activeRemoteInspections += 1;
  const ownsBrowser = !options.browser;
  let browser: Browser | null = options.browser ?? null;
  let context: BrowserContext | null = null;

  try {
    browser ??= await chromium.launch({ headless: true });
    context = await browser.newContext({
      acceptDownloads: false,
      javaScriptEnabled: true,
      locale: "en-US",
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    page.setDefaultTimeout(options.actionTimeoutMs ?? 10_000);
    page.setDefaultNavigationTimeout(options.timeoutMs ?? 30_000);
    await page.context().grantPermissions([]);
    await installReadOnlyPageGuards(page);
    const requestBudget = { count: 0, exceeded: false };
    await installRequestPolicy(page, prepared.provider, requestBudget, options.maxRequests ?? 300);
    const response = await page.goto(prepared.url.href, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 30_000
    });
    if (response?.status() === 429) {
      throw new WebFormProviderThrottleError(
        "The form provider is throttling inspection. Use the manual form or try again later."
      );
    }
    if (requestBudget.exceeded) {
      throw new WebFormResourceLimitError(
        "The provider page exceeded the isolated browser resource budget. Use the reviewed manual hand-off."
      );
    }
    await waitForProviderBoundary(page, prepared.provider, options.timeoutMs ?? 30_000);

    let finalPrepared;
    try {
      finalPrepared = prepareWebFormUrl(page.url());
    } catch {
      throw new WebFormUrlPolicyError(
        "Only public responder forms that do not require sign-in are supported."
      );
    }
    if (finalPrepared.provider !== prepared.provider) {
      throw new WebFormUrlPolicyError("The responder redirected to a different form provider.");
    }
    const source: WebFormInspectionSource = {
      provider: prepared.provider,
      origin: finalPrepared.url.origin,
      urlFingerprint: createHash("sha256").update(finalPrepared.url.href).digest("hex"),
      queryParametersRemoved: prepared.queryParametersRemoved || finalPrepared.queryParametersRemoved
    };
    const inspection = await inspectWebFormPage(page, prepared.provider, source);
    if (inspection.outOfScopeReasons.length > 0) {
      throw new WebFormUrlPolicyError(inspection.outOfScopeReasons[0]);
    }
    return inspection;
  } finally {
    await context?.close();
    if (ownsBrowser) await browser?.close();
    activeRemoteInspections = Math.max(0, activeRemoteInspections - 1);
  }
}

export function inspectWebFormPage(
  page: Page,
  provider: WebFormProvider,
  source: WebFormInspectionSource | null = null
): Promise<WebFormInspection> {
  return provider === "google_forms"
    ? inspectGoogleFormsPage(page, source)
    : inspectMicrosoftFormsPage(page, source);
}

async function installReadOnlyPageGuards(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      window.addEventListener("submit", function (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      Object.defineProperty(HTMLFormElement.prototype, "submit", {
        configurable: false,
        value: function () { return undefined; }
      });
      Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
        configurable: false,
        value: function () { return undefined; }
      });
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: false,
        value: function () { return false; }
      });
    `
  });
}

async function installRequestPolicy(
  page: Page,
  provider: WebFormProvider,
  budget: { count: number; exceeded: boolean },
  maxRequests: number
): Promise<void> {
  await page.route("**/*", async (route) => {
    budget.count += 1;
    if (budget.count > maxRequests) {
      budget.exceeded = true;
      await route.abort("blockedbyclient");
      return;
    }
    if (["font", "image", "media"].includes(route.request().resourceType())) {
      await route.abort("blockedbyclient");
      return;
    }
    await enforceRequestPolicy(route, page, provider);
  });
}

async function enforceRequestPolicy(route: Route, page: Page, provider: WebFormProvider): Promise<void> {
  const request = route.request();
  const decision = decideWebFormRequest({
    provider,
    method: request.method(),
    url: request.url(),
    mainFrameNavigation: request.isNavigationRequest() && request.frame() === page.mainFrame()
  });
  if (decision.action === "abort") {
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue(decision.sanitizedUrl ? { url: decision.sanitizedUrl } : undefined);
}

export function decideWebFormRequest(input: WebFormRequestPolicyInput): WebFormRequestPolicyDecision {
  if (!["GET", "HEAD", "OPTIONS"].includes(input.method.toUpperCase())) return { action: "abort" };
  if (input.mainFrameNavigation) {
    try {
      const prepared = prepareWebFormUrl(input.url);
      if (prepared.provider !== input.provider) return { action: "abort" };
      return {
        action: "continue",
        sanitizedUrl: prepared.url.href === input.url ? null : prepared.url.href
      };
    } catch {
      return { action: "abort" };
    }
  }
  return isProviderAssetUrlAllowed(input.provider, input.url)
    ? { action: "continue", sanitizedUrl: null }
    : { action: "abort" };
}

async function waitForProviderBoundary(page: Page, provider: WebFormProvider, timeoutMs: number): Promise<void> {
  const selector = provider === "google_forms"
    ? 'form[action*="formResponse"], [role="heading"][aria-level="1"]'
    : '[data-automation-id="formTitle"], [data-automation-id="questionItem"]';
  await page.waitForSelector(selector, { state: "attached", timeout: timeoutMs });
}
