import { createHash } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { isWebFormDefinition, listFormFields } from "../domain/form_definition";
import {
  answerFingerprint,
  isFieldApplicable
} from "../domain/session";
import type {
  AnswerValue,
  FormSession,
  WebFormField,
  WebFormPlacedControl,
  WebFormProvider
} from "../domain/schemas";

export class WebFormFillError extends Error {
  constructor(
    readonly code: "unsupported_answer" | "locator_missing" | "placement_failed" | "verification_failed",
    message: string
  ) {
    super(message);
  }
}

export async function fillAndVerifyWebFormPage(
  page: Page,
  session: FormSession,
  now = new Date()
): Promise<WebFormPlacedControl[]> {
  if (!isWebFormDefinition(session.form)) {
    throw new WebFormFillError("unsupported_answer", "Browser preparation requires a web-form session.");
  }

  const placed: WebFormPlacedControl[] = [];
  for (const field of listFormFields(session.form)) {
    const answer = session.answers[field.id];
    if (field.support.status !== "supported"
      || !isFieldApplicable(session, field)
      || answer?.status !== "answered"
      || answer.value === null) continue;
    const target = field.deliveryTargets[0];
    if (!target) {
      throw new WebFormFillError("locator_missing", `No deterministic target is available for “${field.label}”.`);
    }

    const control = await resolveControl(
      page,
      session.form.source.provider,
      field,
      target.locatorCandidates.map((candidate) => `${candidate.kind}:${candidate.value}`)
    );
    const normalizedValue = await placeAndReadControl(control, field, answer.value);
    const expected = normalizeCanonicalValue(field, answer.value);
    if (!sameNormalizedValue(normalizedValue, expected)) {
      throw new WebFormFillError(
        "verification_failed",
        `The provider control for “${field.label}” did not match the canonical answer after filling.`
      );
    }

    placed.push({
      fieldId: field.id,
      fieldLabel: field.label,
      providerFieldId: field.providerFieldId,
      locator: control.locatorDescription,
      answerFingerprint: sha256(answerFingerprint(session, field.id)),
      controlFingerprint: sha256(JSON.stringify({
        providerFieldId: field.providerFieldId,
        locator: control.locatorDescription,
        normalizedValue
      })),
      normalizedValue,
      verifiedAt: now.toISOString()
    });
  }
  return placed;
}

export async function verifyPlacedWebFormControls(
  page: Page,
  session: FormSession,
  placedControls: WebFormPlacedControl[],
  now = new Date()
): Promise<WebFormPlacedControl[]> {
  if (!isWebFormDefinition(session.form)) {
    throw new WebFormFillError("unsupported_answer", "Browser verification requires a web-form session.");
  }
  const expectedFields = listFormFields(session.form).filter((field) => {
    const answer = session.answers[field.id];
    return field.support.status === "supported"
      && isFieldApplicable(session, field)
      && answer?.status === "answered"
      && answer.value !== null;
  });
  if (expectedFields.length !== placedControls.length) {
    throw new WebFormFillError(
      "verification_failed",
      "The prepared provider controls no longer match the current canonical answer set."
    );
  }

  const verified: WebFormPlacedControl[] = [];
  for (const field of expectedFields) {
    const answer = session.answers[field.id];
    const placed = placedControls.find((candidate) => candidate.fieldId === field.id);
    if (!placed || answer?.status !== "answered" || answer.value === null) {
      throw new WebFormFillError("verification_failed", "A prepared provider control is no longer current.");
    }
    const target = field.deliveryTargets[0];
    if (!target) throw new WebFormFillError("locator_missing", "A deterministic provider target is missing.");
    const control = await resolveControl(
      page,
      session.form.source.provider,
      field,
      target.locatorCandidates.map((candidate) => `${candidate.kind}:${candidate.value}`)
    );
    const normalizedValue = await readControlValue(control, field);
    const expectedValue = normalizeCanonicalValue(field, answer.value);
    const expectedAnswerFingerprint = sha256(answerFingerprint(session, field.id));
    const controlFingerprint = sha256(JSON.stringify({
      providerFieldId: field.providerFieldId,
      locator: control.locatorDescription,
      normalizedValue
    }));
    if (!sameNormalizedValue(normalizedValue, expectedValue)
      || placed.answerFingerprint !== expectedAnswerFingerprint
      || placed.locator !== control.locatorDescription
      || placed.controlFingerprint !== controlFingerprint) {
      throw new WebFormFillError(
        "verification_failed",
        `The provider control for “${field.label}” changed after preparation.`
      );
    }
    verified.push({ ...placed, normalizedValue, verifiedAt: now.toISOString() });
  }
  return verified;
}

export async function findProviderSubmitButton(
  page: Page,
  provider: WebFormProvider
): Promise<Locator> {
  const candidates = provider === "google_forms"
    ? [
        page.locator('[role="button"][jsname="M2UYVd"]'),
        page.getByRole("button", { name: /^submit$/i }),
        page.locator('[role="button"]').filter({ hasText: /^\s*submit\s*$/i }),
        page.locator('button[type="submit"], input[type="submit"]')
      ]
    : [
        page.locator('[data-automation-id="submitButton"]'),
        page.getByRole("button", { name: /^submit$/i }),
        page.locator('button[type="submit"], input[type="submit"]')
      ];
  for (const candidate of candidates) {
    if (await candidate.count() > 0 && await candidate.first().isVisible()) return candidate.first();
  }
  throw new WebFormFillError(
    "locator_missing",
    "The provider’s final Submit control is not available on this inspected page."
  );
}

interface ResolvedControl {
  root: Locator;
  direct: Locator | null;
  locatorDescription: string;
}

async function resolveControl(
  page: Page,
  provider: WebFormProvider,
  field: WebFormField,
  locatorDescriptions: string[]
): Promise<ResolvedControl> {
  const providerCandidate = field.deliveryTargets
    .flatMap((target) => target.locatorCandidates)
    .find((candidate) => candidate.kind === "provider_id");
  if (providerCandidate) {
    const direct = provider === "google_forms"
      ? page.locator([
          `[name="${cssAttributeValue(providerCandidate.value)}"]`,
          `[name="${cssAttributeValue(`${providerCandidate.value}_sentinel`)}"]`
        ].join(", ")).first()
      : page.locator(`[id="${cssAttributeValue(`QuestionId_${providerCandidate.value}`)}"]`).first();
    if (await direct.count() > 0) {
      const root = provider === "google_forms"
        ? direct.locator('xpath=ancestor::*[@role="listitem"][1]')
        : direct.locator('xpath=ancestor::*[@data-automation-id="questionItem"][1]');
      if (await root.count() > 0 || provider !== "google_forms") {
        return {
          root: await root.count() > 0 ? root : direct,
          direct,
          locatorDescription: `provider_id:${providerCandidate.value}`
        };
      }
    }
    if (provider === "google_forms") {
      const root = await findGoogleQuestionRoot(page, providerCandidate.value);
      if (root) {
        return {
          root,
          direct: null,
          locatorDescription: `provider_id:${providerCandidate.value}`
        };
      }
    }
  }

  const labelCandidate = field.deliveryTargets
    .flatMap((target) => target.locatorCandidates)
    .find((candidate) => candidate.kind === "accessible_label");
  if (labelCandidate) {
    const direct = page.getByLabel(labelCandidate.value, { exact: true }).first();
    if (await direct.count() > 0) {
      const root = provider === "google_forms"
        ? direct.locator('xpath=ancestor::*[@role="listitem"][1]')
        : direct.locator('xpath=ancestor::*[@data-automation-id="questionItem"][1]');
      return {
        root: await root.count() > 0 ? root : direct,
        direct,
        locatorDescription: `accessible_label:${labelCandidate.value}`
      };
    }
  }

  throw new WebFormFillError(
    "locator_missing",
    `The provider control for “${field.label}” could not be found with ${locatorDescriptions.join(" or ")}.`
  );
}

async function findGoogleQuestionRoot(page: Page, providerFieldId: string): Promise<Locator | null> {
  const match = /^entry\.(\d+)$/.exec(providerFieldId);
  if (!match?.[1]) return null;
  const providerQuestionId = match[1];
  const candidates = page.locator(`[data-params*="${providerQuestionId}"]`);
  const exactId = new RegExp(`(?:^|\\D)${providerQuestionId}(?:\\D|$)`);
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    const dataParams = await candidate.getAttribute("data-params");
    if (dataParams && exactId.test(dataParams)) return candidate;
  }
  return null;
}

async function placeAndReadControl(
  control: ResolvedControl,
  field: WebFormField,
  value: AnswerValue
): Promise<string | string[]> {
  if (["short_text", "long_text", "email", "phone", "date", "time", "number"].includes(field.type)) {
    if (typeof value === "object") throw unsupportedValue(field);
    const input = await textInput(control);
    const text = String(value);
    await input.fill(text);
    await input.dispatchEvent("change");
    return await input.inputValue();
  }

  if (["single_choice", "scale", "rating"].includes(field.type)) {
    if (typeof value === "object") throw unsupportedValue(field);
    const option = await optionControl(control.root, String(value), ["radio", "option"]);
    await selectOption(option);
    if (!await isSelected(option)) {
      throw new WebFormFillError("verification_failed", `“${field.label}” did not retain the selected option.`);
    }
    return String(value);
  }

  if (field.type === "multi_choice") {
    if (!Array.isArray(value)) throw unsupportedValue(field);
    for (const selected of value) {
      const option = await optionControl(control.root, selected, ["checkbox"]);
      if (!await isSelected(option)) await selectOption(option);
      if (!await isSelected(option)) {
        throw new WebFormFillError("verification_failed", `“${field.label}” did not retain “${selected}”.`);
      }
    }
    const selectedValues: string[] = [];
    for (const optionValue of field.options) {
      const option = await optionalOptionControl(control.root, optionValue, ["checkbox"]);
      if (option && await isSelected(option)) selectedValues.push(optionValue);
    }
    return selectedValues.length > 0 ? selectedValues : [...value];
  }

  if (field.type === "boolean") {
    if (typeof value !== "boolean") throw unsupportedValue(field);
    const checkbox = control.root.getByRole("checkbox").first();
    if (await checkbox.count() > 0) {
      if (await isSelected(checkbox) !== value) await selectOption(checkbox);
      if (await isSelected(checkbox) !== value) {
        throw new WebFormFillError("verification_failed", `“${field.label}” did not retain the boolean value.`);
      }
      return String(value);
    }
    const option = await optionControl(control.root, value ? "Yes" : "No", ["radio"]);
    await selectOption(option);
    return String(value);
  }

  throw new WebFormFillError(
    "unsupported_answer",
    `“${field.label}” uses a control that cannot be filled deterministically.`
  );
}

async function readControlValue(
  control: ResolvedControl,
  field: WebFormField
): Promise<string | string[]> {
  if (["short_text", "long_text", "email", "phone", "date", "time", "number"].includes(field.type)) {
    return textInput(control).then((input) => input.inputValue());
  }
  if (["single_choice", "scale", "rating"].includes(field.type)) {
    for (const optionValue of field.options) {
      const option = await optionalOptionControl(control.root, optionValue, ["radio", "option"]);
      if (option && await isSelected(option)) return optionValue;
    }
    throw new WebFormFillError("verification_failed", `“${field.label}” no longer has a selected option.`);
  }
  if (field.type === "multi_choice") {
    const selectedValues: string[] = [];
    for (const optionValue of field.options) {
      const option = await optionalOptionControl(control.root, optionValue, ["checkbox"]);
      if (option && await isSelected(option)) selectedValues.push(optionValue);
    }
    return selectedValues;
  }
  if (field.type === "boolean") {
    const checkbox = control.root.getByRole("checkbox").first();
    if (await checkbox.count() > 0) return String(await isSelected(checkbox));
    for (const optionValue of ["Yes", "No"]) {
      const option = await optionalOptionControl(control.root, optionValue, ["radio"]);
      if (option && await isSelected(option)) return String(optionValue === "Yes");
    }
    throw new WebFormFillError("verification_failed", `“${field.label}” no longer has a boolean value.`);
  }
  throw unsupportedValue(field);
}

async function textInput(control: ResolvedControl): Promise<Locator> {
  if (control.direct && await control.direct.evaluate(
    (element) => element.matches("input:not([type=hidden]), textarea")
  )) {
    return control.direct;
  }
  const input = control.root.locator(
    'textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"])'
  ).first();
  if (await input.count() === 0) {
    throw new WebFormFillError("locator_missing", "The provider text input is no longer present.");
  }
  return input;
}

async function optionControl(root: Locator, value: string, roles: Array<"radio" | "checkbox" | "option">): Promise<Locator> {
  const option = await optionalOptionControl(root, value, roles);
  if (option) return option;
  throw new WebFormFillError("locator_missing", `The provider option “${value}” is no longer present.`);
}

async function optionalOptionControl(
  root: Locator,
  value: string,
  roles: Array<"radio" | "checkbox" | "option">
): Promise<Locator | null> {
  for (const role of roles) {
    const candidate = root.getByRole(role, { name: value, exact: true }).first();
    if (await candidate.count() > 0) return candidate;
  }
  const select = root.locator("select").first();
  if (await select.count() > 0) {
    const option = select.getByRole("option", { name: value, exact: true }).first();
    if (await option.count() > 0) return option;
  }
  return null;
}

async function selectOption(option: Locator): Promise<void> {
  const tag = await option.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "select") return;
  if (tag === "option") {
    const label = (await option.textContent())?.trim() ?? "";
    await option.locator("xpath=parent::select").selectOption({ label });
    return;
  }
  const type = await option.getAttribute("type");
  if (type === "radio" || type === "checkbox") {
    await option.check();
    return;
  }
  await option.click();
}

async function isSelected(option: Locator): Promise<boolean> {
  return option.evaluate((element) => {
    if (element instanceof HTMLInputElement) return element.checked;
    if (element instanceof HTMLOptionElement) return element.selected;
    return element.getAttribute("aria-checked") === "true"
      || element.getAttribute("aria-selected") === "true"
      || element.getAttribute("data-is-selected") === "true";
  });
}

function normalizeCanonicalValue(field: WebFormField, value: AnswerValue): string | string[] {
  if (Array.isArray(value)) return [...value];
  if (typeof value === "object") throw unsupportedValue(field);
  return String(value);
}

function sameNormalizedValue(actual: string | string[], expected: string | string[]): boolean {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
    return [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000");
  }
  return actual === expected;
}

function unsupportedValue(field: WebFormField): WebFormFillError {
  return new WebFormFillError(
    "unsupported_answer",
    `The canonical answer for “${field.label}” cannot be represented by this provider control.`
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
}
