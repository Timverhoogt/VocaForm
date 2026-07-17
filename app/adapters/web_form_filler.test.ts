import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileWebFormInspection } from "./web_form_compiler";
import {
  fillAndVerifyWebFormPage,
  findProviderSubmitButton,
  verifyPlacedWebFormControls
} from "./web_form_filler";
import {
  finalizeWebFormInspection,
  type RawWebFormInspection
} from "./web_form_inspection";
import { createFormSession, saveTextAnswer } from "../domain/session";
import type { FormSession } from "../domain/schemas";

const RESPONDER_URL = "https://docs.google.com/forms/d/e/goal4/viewform";

describe("deterministic web-form filling", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it("places and re-reads every canonical answer without activating Submit", async () => {
    const page = await browser.newPage();
    await page.setContent(googleFormHtml());
    await page.evaluate(() => {
      (globalThis as typeof globalThis & { goal4Submits: number }).goal4Submits = 0;
      document.querySelector("form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        (globalThis as typeof globalThis & { goal4Submits: number }).goal4Submits += 1;
      });
    });

    const session = answeredSession();
    const placed = await fillAndVerifyWebFormPage(page, session, new Date("2026-07-17T12:00:00.000Z"));

    expect(placed).toHaveLength(4);
    expect(placed.every((control) => /^[a-f0-9]{64}$/.test(control.answerFingerprint))).toBe(true);
    expect(placed.every((control) => /^[a-f0-9]{64}$/.test(control.controlFingerprint))).toBe(true);
    expect(placed.map((control) => control.normalizedValue)).toEqual([
      "Sam Rivera",
      "Email",
      ["Advice", "Transport"],
      "2026-07-21"
    ]);
    expect(await page.getByLabel("Full name").inputValue()).toBe("Sam Rivera");
    expect(await page.locator('[aria-label="Email"]').isChecked()).toBe(true);
    expect(await page.locator('[aria-label="Advice"]').isChecked()).toBe(true);
    expect(await page.locator('[aria-label="Transport"]').isChecked()).toBe(true);
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { goal4Submits: number }
    ).goal4Submits)).toBe(0);
    await expect(verifyPlacedWebFormControls(page, session, placed)).resolves.toHaveLength(4);
    await page.getByLabel("Full name").fill("Provider drift");
    await expect(verifyPlacedWebFormControls(page, session, placed)).rejects.toMatchObject({
      code: "verification_failed"
    });
    await expect(findProviderSubmitButton(page, "google_forms")).resolves.toBeDefined();
    await page.close();
  });

  it("recognizes a localized Google Submit control by its provider identity", async () => {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html>
      <html lang="nl">
        <body>
          <div role="button" jsname="M2UYVd" tabindex="0">Verzenden</div>
          <div role="button" tabindex="0">Formulier wissen</div>
        </body>
      </html>`);

    const submit = await findProviderSubmitButton(page, "google_forms");

    expect(await submit.textContent()).toBe("Verzenden");
    await page.close();
  });

  it("uses Microsoft question IDs for text, choice, and rating controls", async () => {
    const page = await browser.newPage();
    await page.setContent(microsoftFormHtml());
    const inspection = finalizeWebFormInspection({
      provider: "microsoft_forms",
      title: "Goal 4 Microsoft request",
      locale: "en-US",
      description: null,
      sections: [],
      questions: [
        question("ms1", "Reference name", "short_text", true, []),
        question("ms2", "Contact method", "single_choice", true, ["Email", "Phone"]),
        question("ms3", "Urgency", "rating", false, ["1", "2", "3", "4", "5"])
      ],
      hasNextPage: false,
      warnings: []
    }, {
      provider: "microsoft_forms",
      origin: "https://forms.office.com",
      urlFingerprint: "d".repeat(64),
      queryParametersRemoved: false
    });
    const form = compileWebFormInspection(inspection).form;
    let session = createFormSession(form);
    session = saveTextAnswer(session, form.sections[0]!.fields[0]!.id, "Sam Rivera");
    session = saveTextAnswer(session, form.sections[0]!.fields[1]!.id, "Phone");
    session = saveTextAnswer(session, form.sections[0]!.fields[2]!.id, "5");

    const placed = await fillAndVerifyWebFormPage(page, session);

    expect(placed.map((control) => control.locator)).toEqual([
      "provider_id:ms1",
      "provider_id:ms2",
      "provider_id:ms3"
    ]);
    expect(await page.getByLabel("Reference name").inputValue()).toBe("Sam Rivera");
    expect(await page.getByLabel("Phone").isChecked()).toBe(true);
    expect(await page.getByLabel("5").isChecked()).toBe(true);
    await expect(findProviderSubmitButton(page, "microsoft_forms")).resolves.toBeDefined();
    await page.close();
  });
});

export function answeredSession(): FormSession {
  const inspection = finalizeWebFormInspection(rawInspection(), {
    provider: "google_forms",
    origin: "https://docs.google.com",
    urlFingerprint: createHash("sha256").update(RESPONDER_URL).digest("hex"),
    queryParametersRemoved: false
  });
  const fields = compileWebFormInspection(inspection, new Date("2026-07-17T10:00:00.000Z")).form;
  let session = createFormSession(fields, new Date("2026-07-17T10:01:00.000Z"));
  session = saveTextAnswer(session, fields.sections[0]!.fields[0]!.id, "Sam Rivera");
  session = saveTextAnswer(session, fields.sections[0]!.fields[1]!.id, "Email");
  session = saveTextAnswer(session, fields.sections[0]!.fields[2]!.id, ["Advice", "Transport"]);
  session = saveTextAnswer(session, fields.sections[0]!.fields[3]!.id, "2026-07-21");
  return session;
}

export function googleFormHtml(): string {
  return `<!doctype html>
    <html lang="en-US">
      <head><title>Goal 4 request</title></head>
      <body>
        <main>
          <h1 role="heading" aria-level="1">Goal 4 request</h1>
          <form action="https://docs.google.com/forms/d/e/goal4/formResponse" method="post">
            <div role="list">
              <div role="listitem" data-params='%.@.[1633920210,"Full name",null,0,[[2005620554,null,true]]]'>
                <h2 role="heading" aria-level="3">Full name <span>*</span></h2>
                <input type="text" aria-label="Full name" aria-required="true">
              </div>
              <div role="listitem" data-params='%.@.[2,"Contact method",null,2,[[2,[["Email"],["Phone"]]]]]'>
                <h2 role="heading" aria-level="3">Contact method <span>*</span></h2>
                <input name="entry.2" type="radio" role="radio" aria-label="Email" value="Email">
                <input name="entry.2" type="radio" role="radio" aria-label="Phone" value="Phone">
              </div>
              <div role="listitem" data-params='%.@.[3,"Services",null,4,[[3,[["Advice"],["Transport"]]]]]'>
                <h2 role="heading" aria-level="3">Services</h2>
                <input name="entry.3" type="checkbox" role="checkbox" aria-label="Advice" value="Advice">
                <input name="entry.3" type="checkbox" role="checkbox" aria-label="Transport" value="Transport">
              </div>
              <div role="listitem" data-params='%.@.[4,"Preferred date",null,9,[[4,null]]]'>
                <h2 role="heading" aria-level="3">Preferred date</h2>
                <input name="entry.4" type="date" aria-label="Preferred date">
              </div>
            </div>
            <input name="entry.2005620554" type="hidden">
            <button type="submit">Submit</button>
          </form>
        </main>
      </body>
    </html>`;
}

function microsoftFormHtml(): string {
  return `<!doctype html>
    <html lang="en-US">
      <head><title>Goal 4 Microsoft request</title></head>
      <body>
        <h1 data-automation-id="formTitle">Goal 4 Microsoft request</h1>
        <section data-automation-id="questionItem">
          <div id="QuestionId_ms1">
            <div data-automation-id="questionTitle"><h2 role="heading">Reference name</h2></div>
            <input type="text" aria-label="Reference name">
          </div>
        </section>
        <section data-automation-id="questionItem">
          <div id="QuestionId_ms2">
            <div data-automation-id="questionTitle"><h2 role="heading">Contact method</h2></div>
            <input type="radio" role="radio" aria-label="Email" value="Email">
            <input type="radio" role="radio" aria-label="Phone" value="Phone">
          </div>
        </section>
        <section data-automation-id="questionItem">
          <div id="QuestionId_ms3">
            <div data-automation-id="questionTitle"><h2 role="heading">Urgency</h2></div>
            <div data-automation-id="ratingQuestion">
              <input type="radio" role="radio" aria-label="1" value="1">
              <input type="radio" role="radio" aria-label="2" value="2">
              <input type="radio" role="radio" aria-label="3" value="3">
              <input type="radio" role="radio" aria-label="4" value="4">
              <input type="radio" role="radio" aria-label="5" value="5">
            </div>
          </div>
        </section>
        <button type="submit" data-automation-id="submitButton">Submit</button>
      </body>
    </html>`;
}

function rawInspection(): RawWebFormInspection {
  return {
    provider: "google_forms",
    title: "Goal 4 request",
    locale: "en-US",
    description: null,
    sections: [],
    questions: [
      question("entry.2005620554", "Full name", "short_text", true, []),
      question("entry.2", "Contact method", "single_choice", true, ["Email", "Phone"]),
      question("entry.3", "Services", "multi_choice", false, ["Advice", "Transport"]),
      question("entry.4", "Preferred date", "date", false, [])
    ],
    hasNextPage: false,
    warnings: []
  };
}

function question(
  providerFieldId: string,
  label: string,
  type: RawWebFormInspection["questions"][number]["type"],
  required: boolean,
  options: string[]
): RawWebFormInspection["questions"][number] {
  return {
    providerFieldId,
    label,
    description: null,
    type,
    required,
    options,
    sectionTitle: null,
    locatorCandidates: [{ kind: "provider_id", value: providerFieldId, stability: "high" }]
  };
}
