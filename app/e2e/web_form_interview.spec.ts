import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { buildWebFormDeliveryPlan } from "../adapters/web_form_delivery_adapter";
import { isWebFormDefinition } from "../domain/form_definition";
import { createEmptyMemoryVault, buildSessionMemoryContext } from "../domain/memory";
import { createFormSession, nextOpenField, saveTextAnswer, summarizeSession, verifySession } from "../domain/session";
import type { FormSession, WebFormPreparation } from "../domain/schemas";
import { buildWebFormDomainFixture } from "../evals/web_form_domain_fixture";
import type { SessionView } from "../shared/api";

test("Goal 3 opens a canonical interview and keeps provider submission in the user's hands", async ({ page }) => {
  await page.request.delete("/api/session");
  await page.request.delete("/api/compilation");
  const view = syntheticWebFormView();
  let postedUrl = "";
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (/docs\.google\.com|forms\.office\.com/.test(request.url())) providerRequests.push(request.url());
  });
  await page.route("**/api/session/web-form", async (route) => {
    const body = route.request().postDataJSON() as { url: string };
    postedUrl = body.url;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(view) });
  });

  await page.goto("/");
  await page.getByLabel("Web-form responder link").fill(
    "https://docs.google.com/forms/d/e/synthetic/viewform?usp=pp_url&entry.1=prefilled"
  );
  await page.getByRole("button", { name: "Inspect questions" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Community service request" })).toBeVisible();
  await expect(page.getByText("No provider control has been filled and nothing will be submitted by VocaForm."))
    .toBeVisible();
  expect(postedUrl).toContain("docs.google.com/forms/d/e/synthetic/viewform");
  expect(providerRequests).toEqual([]);

  await page.getByRole("button", { name: "Hand-off" }).click();
  await expect(page.getByRole("heading", { name: "Your reviewed answer list is ready." })).toBeVisible();
  await expect(page.getByText("Submission stays with you")).toBeVisible();
  const handoff = page.getByRole("link", { name: "Open original form" });
  await expect(handoff).toHaveAttribute("target", "_blank");
  await expect(handoff).toHaveAttribute("href", "https://docs.google.com/forms/d/e/synthetic/viewform");
  expect(providerRequests).toEqual([]);
});

test("Goal 4 requires consent, exposes verified native controls, and reserves Submit for the user", async ({ page }) => {
  await page.request.delete("/api/session");
  const session = nativeSinglePageSession();
  if (!isWebFormDefinition(session.form)) throw new Error("Expected a web-form session.");
  const initial = nativeWebFormView(session, { status: "not_started" });
  const browserSessionId = crypto.randomUUID();
  const binding = {
    browserSessionId,
    canonicalSessionId: session.id,
    canonicalSessionVersion: session.version,
    canonicalSessionFingerprint: "c".repeat(64),
    sourceUrlFingerprint: session.form.source.urlFingerprint,
    sourceRevisionFingerprint: session.form.source.revision.fingerprint
  };
  const placedControls = session.form.sections[0]!.fields.map((field, index) => ({
    fieldId: field.id,
    fieldLabel: field.label,
    providerFieldId: field.providerFieldId,
    locator: `provider_id:${field.providerFieldId}`,
    answerFingerprint: String(index + 1).repeat(64),
    controlFingerprint: String(index + 4).repeat(64),
    normalizedValue: session.answers[field.id]!.normalizedAnswer || "",
    verifiedAt: "2026-07-17T12:00:00.000Z"
  }));
  const prepared: WebFormPreparation = {
    status: "awaiting_user_submit",
    ...binding,
    preparedAt: "2026-07-17T12:00:00.000Z",
    expiresAt: "2026-07-17T12:15:00.000Z",
    placedControls,
    screenshotVersion: 1
  };
  const submitted: WebFormPreparation = {
    status: "submitted",
    ...binding,
    submittedAt: "2026-07-17T12:04:00.000Z",
    placedControlCount: placedControls.length,
    screenshotVersion: 2
  };
  let prepareBody: { consent: boolean; sessionVersion: number } | null = null;
  let submitBody: { browserSessionId: string; sessionVersion: number } | null = null;

  await page.route("**/api/session/web-form", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify(initial)
  }));
  await page.route("**/api/web-form/browser/prepare", async (route) => {
    prepareBody = route.request().postDataJSON() as typeof prepareBody;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(nativeWebFormView(session, prepared))
    });
  });
  await page.route("**/api/web-form/browser/submit", async (route) => {
    submitBody = route.request().postDataJSON() as typeof submitBody;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(nativeWebFormView(session, submitted))
    });
  });
  await page.route("**/api/web-form/browser/screenshot**", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  }));

  await page.goto("/");
  await page.getByLabel("Web-form responder link").fill(
    "https://docs.google.com/forms/d/e/synthetic/viewform"
  );
  await page.getByRole("button", { name: "Inspect questions" }).click();
  await page.getByRole("button", { name: "Hand-off" }).click();

  const prepareButton = page.getByRole("button", { name: "Prepare native form" });
  await expect(prepareButton).toBeDisabled();
  await page.getByLabel(/I consent to transmit my current reviewed answers/).check();
  await expect(prepareButton).toBeEnabled();
  await prepareButton.click();

  await expect(page.getByRole("heading", { name: "Review the filled provider form." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verified provider controls" })).toBeVisible();
  await expect(page.getByText("Awaiting your Submit action")).toBeVisible();
  expect(prepareBody).toEqual({ consent: true, sessionVersion: session.version });

  await page.getByRole("button", { name: "Submit in Google Forms" }).click();
  await expect(page.getByRole("heading", { name: "Your Submit action was sent once." })).toBeVisible();
  expect(submitBody).toEqual({ browserSessionId, sessionVersion: session.version });
});

test("Goal 5 keeps provider credentials external and uses a manual signed-in hand-off", async ({ page }) => {
  await page.request.delete("/api/session");
  await page.request.delete("/api/compilation");
  const externalView = syntheticWebFormView();
  externalView.webForm!.access = "external";
  externalView.webForm!.warnings = [
    "Sign in only on the provider page. VocaForm uses a manual copy hand-off."
  ];
  externalView.deliveryPlan = buildWebFormDeliveryPlan(externalView.session, {
    nativePreparationAllowed: false
  });
  let postedAccess = "";
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (/docs\.google\.com|forms\.office\.com/.test(request.url())) providerRequests.push(request.url());
  });
  await page.route("**/api/session/web-form", async (route) => {
    const body = route.request().postDataJSON() as { access: string };
    postedAccess = body.access;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(externalView)
    });
  });

  await page.goto("/");
  await page.getByLabel("Web-form responder link").fill("https://docs.google.com/forms/d/e/private/viewform");
  await page.getByLabel(/Sign-in required/).check();
  await page.getByRole("button", { name: "Inspect questions" }).click();

  await expect(page.getByLabel("Upload step").getByRole("heading", { name: "Community service request" })).toBeVisible();
  const providerSignIn = page.getByRole("link", { name: "Open Google Forms sign-in" });
  await expect(providerSignIn).toHaveAttribute("target", "_blank");
  await expect(providerSignIn).toHaveAttribute("href", "https://docs.google.com/forms/d/e/synthetic/viewform");
  await expect(page.getByLabel(/Password/i)).toHaveCount(0);
  expect(postedAccess).toBe("external");
  expect(providerRequests).toEqual([]);

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical"
  )).toEqual([]);

  await page.getByRole("button", { name: "Hand-off" }).click();
  await expect(page.getByRole("heading", { name: "Your reviewed answer list is ready." })).toBeVisible();
  const handoff = page.getByRole("link", { name: "Open signed-in form" });
  await expect(handoff).toHaveAttribute("target", "_blank");
  await expect(handoff).toHaveAttribute("href", "https://docs.google.com/forms/d/e/synthetic/viewform");
  expect(providerRequests).toEqual([]);
});

for (const provider of ["google_forms", "microsoft_forms"] as const) {
  test(`Goal 6A keeps ${provider} drift recovery keyboard-accessible at low-vision reflow`, async ({ page }) => {
    const fallbackView = hardenedFallbackView(provider);
    await page.route("**/api/session/web-form", (route) => route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(fallbackView)
    }));

    await page.goto("/");
    await page.getByLabel("Web-form responder link").fill(fallbackView.webForm!.handoffUrl);
    await page.getByRole("button", { name: "Inspect questions" }).click();
    await page.getByRole("button", { name: "Hand-off" }).click();

    await expect(page.getByText(/provider contract did not meet the confidence/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your reviewed answer list is ready." })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBe(true);

    const back = page.getByRole("button", { name: "Back to review" });
    const manualLink = page.getByRole("link", { name: "Open original form" });
    await back.focus();
    await page.keyboard.press("Tab");
    await expect(manualLink).toBeFocused();

    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
}

function syntheticWebFormView(): SessionView {
  const session = createFormSession(buildWebFormDomainFixture(), new Date("2026-07-17T10:00:00.000Z"));
  return {
    session,
    summary: summarizeSession(session),
    verification: verifySession(session),
    nextField: nextOpenField(session),
    memory: buildSessionMemoryContext(createEmptyMemoryVault(), session),
    deliveryPlan: buildWebFormDeliveryPlan(session),
    webForm: {
      access: "public",
      handoffUrl: "https://docs.google.com/forms/d/e/synthetic/viewform",
      warnings: ["This synthetic form includes controls that need guided manual handling."],
      preparation: { status: "not_started" }
    }
  };
}

function nativeSinglePageSession(): FormSession {
  const form = buildWebFormDomainFixture();
  form.sections = [form.sections[0]!];
  form.flow.pages = [form.flow.pages[0]!];
  form.flow.edges = [{
    id: "finish",
    kind: "submit",
    fromPageId: "page_1",
    toPageId: null,
    condition: null
  }];
  form.source.revision.questionCount = form.sections[0]!.fields.length;
  form.source.revision.pageCount = 1;
  let session = createFormSession(form, new Date("2026-07-17T10:00:00.000Z"));
  session = saveTextAnswer(session, "contact_method", "Email");
  session = saveTextAnswer(session, "start_time", "09:30");
  session = saveTextAnswer(session, "confidence", "4");
  return session;
}

function nativeWebFormView(session: FormSession, preparation: WebFormPreparation): SessionView {
  return {
    session,
    summary: summarizeSession(session),
    verification: verifySession(session),
    nextField: nextOpenField(session),
    memory: buildSessionMemoryContext(createEmptyMemoryVault(), session),
    deliveryPlan: buildWebFormDeliveryPlan(session),
    webForm: {
      access: "public",
      handoffUrl: "https://docs.google.com/forms/d/e/synthetic/viewform",
      warnings: [],
      preparation
    }
  };
}

function hardenedFallbackView(provider: "google_forms" | "microsoft_forms"): SessionView {
  const session = nativeSinglePageSession();
  if (!isWebFormDefinition(session.form)) throw new Error("Expected a web-form session.");
  session.form.source.provider = provider;
  session.form.source.responderOrigin = provider === "google_forms"
    ? "https://docs.google.com/"
    : "https://forms.office.com/";
  const view = nativeWebFormView(session, { status: "not_started" });
  view.deliveryPlan = buildWebFormDeliveryPlan(session, { runtimeFallbackReason: "provider_drift" });
  view.webForm = {
    access: "public",
    handoffUrl: provider === "google_forms"
      ? "https://docs.google.com/forms/d/e/synthetic/viewform"
      : "https://forms.office.com/r/synthetic",
    warnings: [
      "The provider contract did not meet the confidence required for native preparation. The reviewed manual answer list remains available."
    ],
    preparation: { status: "not_started" }
  };
  return view;
}
