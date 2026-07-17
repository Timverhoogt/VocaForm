import { describe, expect, it } from "vitest";
import { listFormFields } from "../domain/form_definition";
import {
  createFormSession,
  nextOpenField,
  saveTextAnswer,
  summarizeSession,
  verifySession
} from "../domain/session";
import { compileWebFormInspection } from "./web_form_compiler";
import {
  finalizeWebFormInspection,
  type RawWebFormInspection,
  type WebFormInspectionSource
} from "./web_form_inspection";

const SOURCE: WebFormInspectionSource = {
  provider: "google_forms",
  origin: "https://docs.google.com",
  urlFingerprint: "a".repeat(64),
  queryParametersRemoved: true
};

describe("web-form inspection compiler", () => {
  it("recalls every observed question without fabricating fields or choice values", () => {
    const inspection = finalizeWebFormInspection(rawInspection(), SOURCE);
    const result = compileWebFormInspection(inspection, new Date("2026-07-17T09:00:00.000Z"));
    const fields = listFormFields(result.form);

    expect(fields.map((field) => field.label)).toEqual(inspection.questions.map((question) => question.label));
    expect(fields.map((field) => field.options)).toEqual(inspection.questions.map((question) => question.options));
    expect(result.form.source).toMatchObject({
      provider: "google_forms",
      responderOrigin: "https://docs.google.com/",
      revision: { questionCount: 5, pageCount: 1 }
    });
    expect(result.form.flow.coverage).toBe("current_page_only");
    expect(fields[0]).toMatchObject({ memoryKey: "contact.full_name", support: { status: "supported" } });
    expect(fields[1]).toMatchObject({ memoryKey: "contact.email", support: { status: "supported" } });
    expect(fields[2]?.options).toEqual(["Email", "Phone"]);
    expect(result.blockedFieldIds).toEqual([fields[4]?.id]);

    let session = createFormSession(result.form);
    session = saveTextAnswer(session, fields[0]!.id, "Sam Rivera");
    session = saveTextAnswer(session, fields[1]!.id, "sam@example.com");
    session = saveTextAnswer(session, fields[2]!.id, "Email");
    session = saveTextAnswer(session, fields[3]!.id, "4");
    expect(nextOpenField(session)).toBeNull();
    expect(summarizeSession(session).completionPercent).toBe(100);
  });

  it("turns incomplete coverage and unsupported controls into visible blockers", () => {
    const result = compileWebFormInspection(finalizeWebFormInspection(rawInspection(), SOURCE));
    const verification = verifySession(createFormSession(result.form));

    expect(verification.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining([
      "unsupported_control",
      "unsupported_flow"
    ]));
    expect(verification.readyForFinalExport).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("another page"))).toBe(true);
  });

  it("rejects fixture-only and explicitly out-of-scope inspections", () => {
    const local = finalizeWebFormInspection(rawInspection());
    expect(() => compileWebFormInspection(local)).toThrow("remote responder source");

    const quiz = finalizeWebFormInspection({
      ...rawInspection(),
      outOfScopeReasons: ["Quizzes are out of scope."]
    }, SOURCE);
    expect(() => compileWebFormInspection(quiz)).toThrow("Quizzes are out of scope");
  });
});

function rawInspection(): RawWebFormInspection {
  return {
    provider: "google_forms",
    title: "Community check-in",
    locale: "en-US",
    description: "A public form",
    sections: ["Details", "Preferences"],
    questions: [
      question("entry.1", "Full name", "short_text", true, [], "Details"),
      question("entry.2", "Email", "email", true, [], "Details"),
      question("entry.3", "Contact method", "single_choice", true, ["Email", "Phone"], "Preferences"),
      question("entry.4", "Satisfaction", "scale", false, ["1", "2", "3", "4", "5"], "Preferences"),
      question("entry.5", "Supporting file", "file_upload", false, [], "Preferences")
    ],
    hasNextPage: true,
    warnings: []
  };
}

function question(
  providerFieldId: string,
  label: string,
  type: RawWebFormInspection["questions"][number]["type"],
  required: boolean,
  options: string[],
  sectionTitle: string
): RawWebFormInspection["questions"][number] {
  return {
    providerFieldId,
    label,
    description: null,
    type,
    required,
    options,
    sectionTitle,
    locatorCandidates: [{ kind: "provider_id", value: providerFieldId, stability: "high" }]
  };
}
