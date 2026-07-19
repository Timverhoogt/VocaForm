import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { buildWebFormDeliveryPlan } from "../app/adapters/web_form_delivery_adapter";
import { isWebFormDefinition } from "../app/domain/form_definition";
import { buildSessionMemoryContext, createEmptyMemoryVault } from "../app/domain/memory";
import {
  createFormSession,
  nextOpenField,
  saveTextAnswer,
  summarizeSession,
  verifySession
} from "../app/domain/session";
import type { FormSession, WebFormPreparation } from "../app/domain/schemas";
import { buildWebFormDomainFixture } from "../app/evals/web_form_domain_fixture";
import type { SessionView } from "../app/shared/api";

const baseUrl = process.env.VOCAFORM_DEMO_URL || "http://127.0.0.1:5183";
const outputRoot = path.resolve(
  process.env.VOCAFORM_VIDEO_DIR || "work/video/iterations/v3-webform-update/product"
);
const destination = path.join(outputRoot, "scene-webform-update.webm");

await fs.mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    baseURL: baseUrl,
    colorScheme: "light",
    deviceScaleFactor: 1,
    recordVideo: {
      dir: outputRoot,
      size: { width: 1920, height: 1080 }
    },
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  const rawVideo = page.video();
  const session = nativeSinglePageSession();
  const initial = nativeWebFormView(session, { status: "not_started" });
  const browserSessionId = "vocaform-demo-web-form-session";
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

  await page.route("**/api/session/web-form", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify(initial)
  }));
  await page.route("**/api/web-form/browser/prepare", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(nativeWebFormView(session, prepared))
  }));
  await page.route("**/api/web-form/browser/screenshot**", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: providerReviewSvg()
  }));

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({
    content: [
      ".demo-notice { display: none !important; }",
      "* { caret-color: transparent !important; }"
    ].join("\n")
  });
  await page.waitForTimeout(1_400);

  const responderLink = page.getByLabel("Web-form responder link");
  await responderLink.fill("https://docs.google.com/forms/d/e/vocaform-demo/viewform");
  await responderLink.hover();
  await page.waitForTimeout(1_150);
  await page.getByRole("button", { name: "Inspect questions" }).click();

  await page.getByRole("heading", { level: 2, name: "Community service request" }).waitFor({
    state: "visible"
  });
  await page.waitForTimeout(4_000);

  await page.getByRole("button", { name: "Hand-off" }).click();
  await page.getByRole("heading", { name: "Choose when answers leave VocaForm." })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(2_700);

  const consent = page.getByLabel(/I consent to transmit my current reviewed answers/);
  await consent.check();
  await page.waitForTimeout(850);
  await page.getByRole("button", { name: "Prepare native form" }).click();

  await page.getByRole("heading", { name: "Review the filled provider form." }).waitFor({
    state: "visible"
  });
  await page.waitForTimeout(4_000);

  const submitButton = page.getByRole("button", { name: "Submit in Google Forms" });
  await submitButton.scrollIntoViewIfNeeded();
  await submitButton.hover();
  await page.waitForTimeout(5_000);

  await page.close();
  await rawVideo.saveAs(destination);
  await context.close();
  process.stdout.write(`${destination}\n`);
} finally {
  await browser.close();
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

function nativeWebFormView(
  session: FormSession,
  preparation: WebFormPreparation
): SessionView {
  if (!isWebFormDefinition(session.form)) {
    throw new Error("The web-form demo requires a web-form session.");
  }
  return {
    session,
    summary: summarizeSession(session),
    verification: verifySession(session),
    nextField: nextOpenField(session),
    memory: buildSessionMemoryContext(createEmptyMemoryVault(), session),
    deliveryPlan: buildWebFormDeliveryPlan(session),
    webForm: {
      access: "public",
      handoffUrl: "https://docs.google.com/forms/d/e/vocaform-demo/viewform",
      warnings: [],
      preparation
    }
  };
}

function providerReviewSvg(): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="820" viewBox="0 0 1400 820">
  <rect width="1400" height="820" fill="#f2eff8"/>
  <rect x="118" y="52" width="1164" height="716" rx="24" fill="#ffffff"/>
  <rect x="118" y="52" width="1164" height="14" rx="7" fill="#673ab7"/>
  <text x="170" y="132" font-family="Arial, sans-serif" font-size="25" fill="#5f6368">Google Forms · reviewed synthetic form</text>
  <text x="170" y="190" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#202124">Community service request</text>
  <text x="170" y="236" font-family="Arial, sans-serif" font-size="23" fill="#5f6368">Prepared answers — nothing has been submitted</text>
  <rect x="170" y="282" width="1060" height="118" rx="15" fill="#fafafa" stroke="#dadce0"/>
  <text x="205" y="326" font-family="Arial, sans-serif" font-size="23" fill="#202124">Preferred contact method</text>
  <circle cx="216" cy="366" r="13" fill="#673ab7"/><circle cx="216" cy="366" r="5" fill="#ffffff"/>
  <text x="245" y="374" font-family="Arial, sans-serif" font-size="22" fill="#202124">Email</text>
  <rect x="170" y="424" width="510" height="142" rx="15" fill="#fafafa" stroke="#dadce0"/>
  <text x="205" y="470" font-family="Arial, sans-serif" font-size="23" fill="#202124">Preferred start time</text>
  <text x="205" y="526" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#673ab7">09:30</text>
  <rect x="720" y="424" width="510" height="142" rx="15" fill="#fafafa" stroke="#dadce0"/>
  <text x="755" y="470" font-family="Arial, sans-serif" font-size="23" fill="#202124">Confidence</text>
  <text x="755" y="526" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#673ab7">4 / 5</text>
  <rect x="170" y="610" width="1060" height="92" rx="15" fill="#eff8f3" stroke="#98c9aa"/>
  <text x="205" y="665" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#215f3d">3 controls re-read and verified</text>
</svg>`.trim();
}
