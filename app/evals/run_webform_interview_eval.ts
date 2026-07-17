import { compileWebFormInspection } from "../adapters/web_form_compiler";
import {
  finalizeWebFormInspection,
  type RawWebFormInspection,
  type WebFormInspectionSource,
  type WebFormProvider,
  type WebFormQuestionType
} from "../adapters/web_form_inspection";
import { listFormFields } from "../domain/form_definition";
import { createFormSession, saveTextAnswer, verifySession } from "../domain/session";

const results = fixtures().map((fixture) => evaluateFixture(fixture));
console.log(JSON.stringify({
  passed: true,
  fieldRecallPercent: 100,
  fabricatedFieldCount: 0,
  fixtures: results
}, null, 2));

interface InterviewFixture {
  name: string;
  raw: RawWebFormInspection;
  source: WebFormInspectionSource;
  answers: Record<string, string | string[]>;
}

function evaluateFixture(fixture: InterviewFixture): Record<string, unknown> {
  const inspection = finalizeWebFormInspection(fixture.raw, fixture.source);
  const { form } = compileWebFormInspection(inspection, new Date("2026-07-17T10:00:00.000Z"));
  const fields = listFormFields(form);
  assertEqual(fields.length, inspection.questions.length, `${fixture.name}: field recall`);
  assertEqual(
    JSON.stringify(fields.map((field) => field.label)),
    JSON.stringify(inspection.questions.map((question) => question.label)),
    `${fixture.name}: labels`
  );
  assertEqual(
    JSON.stringify(fields.map((field) => field.options)),
    JSON.stringify(inspection.questions.map((question) => question.options)),
    `${fixture.name}: options`
  );

  let session = createFormSession(form, new Date("2026-07-17T10:01:00.000Z"));
  for (const field of fields) {
    const value = fixture.answers[field.providerFieldId];
    if (value === undefined) throw new Error(`${fixture.name}: missing synthetic answer for ${field.providerFieldId}`);
    session = saveTextAnswer(session, field.id, value);
  }
  const verification = verifySession(session);
  const blockers = verification.issues.filter((issue) => issue.severity === "blocker");
  assertEqual(blockers.length, 0, `${fixture.name}: deterministic blockers`);

  return {
    name: fixture.name,
    provider: inspection.provider,
    expectedFields: inspection.questions.length,
    recalledFields: fields.length,
    fabricatedFields: 0,
    deterministicBlockers: blockers.length
  };
}

function fixtures(): InterviewFixture[] {
  return [
    fixture("google-interview", "google_forms", "https://docs.google.com", [
      question("entry.1", "Full name", "short_text"),
      question("entry.2", "Contact method", "single_choice", ["Email", "Phone"]),
      question("entry.3", "Visit date", "date"),
      question("entry.4", "Confidence", "scale", ["1", "2", "3", "4", "5"])
    ], {
      "entry.1": "Sam Rivera",
      "entry.2": "Email",
      "entry.3": "2026-08-20",
      "entry.4": "4"
    }),
    fixture("microsoft-interview", "microsoft_forms", "https://forms.office.com", [
      question("ms1", "Describe your request", "long_text"),
      question("ms2", "Services", "multi_choice", ["Advice", "Transport"]),
      question("ms3", "Preferred date", "date"),
      question("ms4", "Service rating", "rating", ["1", "2", "3", "4", "5"])
    ], {
      ms1: "Help planning an accessible route.",
      ms2: ["Advice", "Transport"],
      ms3: "2026-09-01",
      ms4: "5"
    })
  ];
}

function fixture(
  name: string,
  provider: WebFormProvider,
  origin: string,
  questions: RawWebFormInspection["questions"],
  answers: Record<string, string | string[]>
): InterviewFixture {
  return {
    name,
    raw: {
      provider,
      title: `${name} form`,
      locale: "en-US",
      description: "Synthetic public responder fixture",
      sections: ["Questions"],
      questions,
      hasNextPage: false,
      warnings: []
    },
    source: {
      provider,
      origin,
      urlFingerprint: (provider === "google_forms" ? "a" : "b").repeat(64),
      queryParametersRemoved: false
    },
    answers
  };
}

function question(
  providerFieldId: string,
  label: string,
  type: WebFormQuestionType,
  options: string[] = []
): RawWebFormInspection["questions"][number] {
  return {
    providerFieldId,
    label,
    description: null,
    type,
    required: true,
    options,
    sectionTitle: "Questions",
    locatorCandidates: [{ kind: "provider_id", value: providerFieldId, stability: "high" }]
  };
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
}
