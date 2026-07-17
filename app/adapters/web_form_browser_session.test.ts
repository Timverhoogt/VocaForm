import { chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFormSession, saveTextAnswer } from "../domain/session";
import { buildWebFormDomainFixture } from "../evals/web_form_domain_fixture";
import {
  canonicalWebFormSessionFingerprint,
  createPreparedWebFormRuntime,
  decidePreparationRequest
} from "./web_form_browser_session";

describe("web-form browser session boundary", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it("binds preparation to the exact canonical version and answers", () => {
    const form = buildWebFormDomainFixture();
    const session = saveTextAnswer(
      createFormSession(form),
      form.sections[0]!.fields[0]!.id,
      "Email"
    );
    const fingerprint = canonicalWebFormSessionFingerprint(session);
    const changed = saveTextAnswer(session, session.form.sections[0]!.fields[0]!.id, "Phone");

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalWebFormSessionFingerprint(changed)).not.toBe(fingerprint);
  });

  it("allows no write before the explicit submission gate", () => {
    const input = {
      provider: "google_forms" as const,
      method: "POST",
      url: "https://docs.google.com/forms/d/e/goal4/formResponse",
      mainFrameNavigation: false
    };

    expect(decidePreparationRequest({ ...input, submissionAllowed: false })).toEqual({ action: "abort" });
    expect(decidePreparationRequest({ ...input, submissionAllowed: true })).toEqual({
      action: "continue",
      sanitizedUrl: null
    });
    expect(decidePreparationRequest({
      ...input,
      url: "https://attacker.example/collect",
      submissionAllowed: true
    })).toEqual({ action: "abort" });
  });

  it("turns expiry and browser interruption into explicit recoverable states", async () => {
    const expiring = await runtimeFixture(browser, 1);
    expect(expiring.runtime.view(expiring.session, new Date("2026-07-17T12:00:00.002Z"))).toMatchObject({
      status: "recoverable",
      reason: "expired",
      retryAllowed: true
    });

    const interrupted = await runtimeFixture(browser, 60_000);
    await interrupted.page.close();
    await expect(interrupted.runtime.screenshot(
      interrupted.session,
      new Date("2026-07-17T12:00:01.000Z")
    )).rejects.toThrow("interrupted");
    expect(interrupted.runtime.view(
      interrupted.session,
      new Date("2026-07-17T12:00:01.000Z")
    )).toMatchObject({
      status: "recoverable",
      reason: "interrupted",
      retryAllowed: true
    });
    await Promise.all([expiring.runtime.dispose(), interrupted.runtime.dispose()]);
  });

  it("performs exactly one explicit user Submit action and then closes the browser", async () => {
    const prepared = await runtimeFixture(browser, 60_000);

    const submitted = await prepared.runtime.submit(
      prepared.session,
      new Date("2026-07-17T12:00:30.000Z")
    );

    expect(submitted).toMatchObject({ status: "submitted", placedControlCount: 0 });
    expect(prepared.submitCount()).toBe(1);
    await expect(prepared.runtime.submit(prepared.session)).rejects.toThrow("already received");
    expect(prepared.submitCount()).toBe(1);
  });

  it("never retries when the provider result becomes uncertain after the click begins", async () => {
    const prepared = await runtimeFixture(browser, 60_000, true);

    const result = await prepared.runtime.submit(
      prepared.session,
      new Date("2026-07-17T12:00:30.000Z")
    );

    expect(result).toMatchObject({
      status: "submission_uncertain",
      placedControlCount: 0
    });
    expect(prepared.submitCount()).toBe(1);
    await expect(prepared.runtime.submit(prepared.session)).rejects.toThrow("already received");
    expect(prepared.submitCount()).toBe(1);
  });

  it("recovers without submitting when controls drift before the click", async () => {
    const prepared = await runtimeFixture(browser, 60_000, false, true);

    const now = new Date("2026-07-17T12:00:30.000Z");
    await expect(prepared.runtime.submit(prepared.session, now)).rejects.toThrow("interrupted");
    expect(prepared.runtime.view(prepared.session, now)).toMatchObject({
      status: "recoverable",
      reason: "verification_failed"
    });
    expect(prepared.submitCount()).toBe(0);
  });

  it.each([
    ["providerThrottled", "provider_throttled"],
    ["exceeded", "resource_limited"]
  ] as const)("turns the %s browser budget signal into explicit recovery", async (signal, reason) => {
    const prepared = await runtimeFixture(browser, 60_000);
    prepared.resourceBudget[signal] = true;

    expect(prepared.runtime.view(prepared.session)).toMatchObject({
      status: "recoverable",
      reason,
      retryAllowed: true
    });
    await prepared.runtime.dispose();
  });
});

async function runtimeFixture(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  expiresInMs: number,
  interruptOnSubmit = false,
  answeredWithoutPlacement = false
) {
  const context = await browser.newContext({ viewport: { width: 600, height: 400 } });
  const page = await context.newPage();
  let submitCount = 0;
  await page.exposeFunction("recordGoal4Submit", () => {
    submitCount += 1;
  });
  await page.exposeFunction("interruptGoal4Submit", async () => {
    if (interruptOnSubmit) await page.close();
  });
  await page.setContent(`<!doctype html><form><button type="submit">Submit</button></form>`);
  await page.evaluate((shouldInterrupt) => {
    document.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!shouldInterrupt) {
        const confirmation = document.createElement("div");
        confirmation.setAttribute("data-vocaform-submission-confirmation", "true");
        document.body.append(confirmation);
      }
      void (globalThis as typeof globalThis & { recordGoal4Submit: () => Promise<void> }).recordGoal4Submit();
      void (globalThis as typeof globalThis & { interruptGoal4Submit: () => Promise<void> }).interruptGoal4Submit();
    });
  }, interruptOnSubmit);
  const form = buildWebFormDomainFixture();
  const session = answeredWithoutPlacement
    ? saveTextAnswer(createFormSession(form), "contact_method", "Email")
    : createFormSession(form);
  const resourceBudget = { count: 0, exceeded: false, providerThrottled: false };
  const runtime = createPreparedWebFormRuntime({
    context,
    page,
    provider: "google_forms",
    session,
    placedControls: [],
    preparedAt: new Date("2026-07-17T12:00:00.000Z"),
    expiresInMs,
    screenshot: Buffer.from(await page.screenshot({ type: "png" })),
    submissionConfirmationTimeoutMs: 100,
    resourceBudget,
    setSubmissionAllowed() {}
  });
  return {
    page,
    runtime,
    resourceBudget,
    session,
    submitCount() {
      return submitCount;
    }
  };
}
