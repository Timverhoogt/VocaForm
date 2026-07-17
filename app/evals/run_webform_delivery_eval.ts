import { chromium } from "@playwright/test";
import {
  canonicalWebFormSessionFingerprint,
  createPreparedWebFormRuntime,
  decidePreparationRequest
} from "../adapters/web_form_browser_session";
import { fillAndVerifyWebFormPage } from "../adapters/web_form_filler";
import { createFormSession, saveTextAnswer } from "../domain/session";
import { buildWebFormDomainFixture } from "./web_form_domain_fixture";

const RUNS = 10;

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const page = await context.newPage();
    let submitCount = 0;
    await page.exposeFunction("recordDeliveryEvalSubmit", () => {
      submitCount += 1;
    });
    await page.setContent(providerFixtureHtml());
    await page.evaluate(() => {
      document.querySelector("form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void (globalThis as typeof globalThis & {
          recordDeliveryEvalSubmit: () => Promise<void>;
        }).recordDeliveryEvalSubmit();
      });
    });

    const form = buildWebFormDomainFixture();
    let session = createFormSession(form, new Date("2026-07-17T11:00:00.000Z"));
    session = saveTextAnswer(session, "contact_method", "Email");
    session = saveTextAnswer(session, "start_time", "09:30");
    session = saveTextAnswer(session, "confidence", "4");
    let verifiedPlacements = 0;
    let latestPlacements = await fillAndVerifyWebFormPage(page, session);
    verifiedPlacements += latestPlacements.length;
    for (let run = 1; run < RUNS; run += 1) {
      latestPlacements = await fillAndVerifyWebFormPage(page, session);
      verifiedPlacements += latestPlacements.length;
    }

    const blockedWrites = Array.from({ length: 100 }, () => decidePreparationRequest({
      provider: "google_forms",
      method: "POST",
      url: "https://docs.google.com/forms/d/e/goal4/formResponse",
      mainFrameNavigation: false,
      submissionAllowed: false
    })).filter((decision) => decision.action === "abort").length;
    const fingerprint = canonicalWebFormSessionFingerprint(session);
    const changed = saveTextAnswer(session, "contact_method", "Phone");
    const changedFingerprint = canonicalWebFormSessionFingerprint(changed);
    const runtime = createPreparedWebFormRuntime({
      context,
      page,
      provider: "google_forms",
      session,
      placedControls: latestPlacements,
      preparedAt: new Date("2026-07-17T12:00:00.000Z"),
      expiresInMs: 1_000,
      screenshot: Buffer.from(await page.screenshot({ type: "png" })),
      setSubmissionAllowed() {}
    });
    const expired = runtime.view(session, new Date("2026-07-17T12:00:01.001Z"));
    await runtime.dispose();

    const expectedPlacements = RUNS * 3;
    const passed = verifiedPlacements === expectedPlacements
      && latestPlacements.every((control) => /^[a-f0-9]{64}$/.test(control.controlFingerprint))
      && submitCount === 0
      && blockedWrites === 100
      && fingerprint !== changedFingerprint
      && expired.status === "recoverable"
      && expired.reason === "expired";

    console.log("VocaForm Goal 4 web-form delivery evaluation");
    console.log(`Verified placements: ${verifiedPlacements}/${expectedPlacements}`);
    console.log(`Pre-submit writes blocked: ${blockedWrites}/100`);
    console.log(`Unintended submissions: ${submitCount}`);
    console.log(`Current-session fingerprint invalidation: ${fingerprint !== changedFingerprint ? "PASS" : "FAIL"}`);
    console.log(`Expiry recovery state: ${expired.status === "recoverable" ? expired.reason : "FAIL"}`);
    console.log(`Result: ${passed ? "PASS" : "FAIL"}`);
    if (!passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

function providerFixtureHtml(): string {
  return `<!doctype html>
    <html lang="en-US">
      <body>
        <form action="https://docs.google.com/forms/d/e/goal4/formResponse" method="post">
          <div role="listitem">
            <h2 role="heading" aria-level="3">Preferred contact method</h2>
            <input name="provider_contact_method" type="radio" role="radio" aria-label="Email" value="Email">
            <input name="provider_contact_method" type="radio" role="radio" aria-label="Phone" value="Phone">
          </div>
          <div role="listitem">
            <h2 role="heading" aria-level="3">Preferred start time</h2>
            <input name="provider_start_time" type="time" aria-label="Preferred start time">
          </div>
          <div role="listitem">
            <h2 role="heading" aria-level="3">Confidence</h2>
            <input name="provider_confidence" type="radio" role="radio" aria-label="1" value="1">
            <input name="provider_confidence" type="radio" role="radio" aria-label="2" value="2">
            <input name="provider_confidence" type="radio" role="radio" aria-label="3" value="3">
            <input name="provider_confidence" type="radio" role="radio" aria-label="4" value="4">
            <input name="provider_confidence" type="radio" role="radio" aria-label="5" value="5">
          </div>
          <button type="submit">Submit</button>
        </form>
      </body>
    </html>`;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
