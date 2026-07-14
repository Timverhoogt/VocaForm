import {
  formDefinitionSchema,
  formSessionSchema,
  type FormSession,
  type VerificationIssue
} from "../domain/schemas";
import { createFormSession, saveTextAnswer } from "../domain/session";
import { loadGoldenCompilerFixtures } from "./golden_fixtures";

export interface DeterministicVerificationFixture {
  id: string;
  session: FormSession;
  expected: Pick<VerificationIssue, "fieldId" | "kind">;
}

export interface SemanticVerificationFixture {
  id: string;
  session: FormSession;
  expectedKind: "unsupported_claim" | "contradiction" | "ambiguous_answer";
  expectedFieldIds: string[];
}

const START = new Date("2026-07-14T12:00:00.000Z");

export async function loadDeterministicVerificationFixtures(): Promise<DeterministicVerificationFixture[]> {
  const fixtures = await loadGoldenCompilerFixtures();
  const activity = fixtures.find((fixture) => fixture.id === "activity-permission-conditional")!.form;

  const dependencySession = answerSequence(activity, [
    ["will_attend", "Yes"],
    ["transport_home", "Picked up"],
    ["will_attend", "No"]
  ]);
  const unsupportedBase = answerSequence(activity, [["child_name", "Mila Hart"]]);
  const unsupportedSession = replaceAnswerRecord(unsupportedBase, "child_name", {
    source: "import",
    rawAnswer: null
  });
  const invalidBase = createFormSession(activity, START);
  const invalidSession = replaceAnswerRecord(invalidBase, "will_attend", {
    status: "answered",
    value: "maybe",
    rawAnswer: "maybe",
    normalizedAnswer: "maybe",
    confidence: 1,
    source: "text"
  });
  const renderForm = formDefinitionSchema.parse({
    ...activity,
    sections: activity.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => field.id === "child_name" ? {
        ...field,
        renderTargets: [],
        renderFallback: "manual_review"
      } : field)
    }))
  });

  return [
    {
      id: "missing-required-answer",
      session: createFormSession(activity, START),
      expected: { fieldId: "child_name", kind: "required_missing" }
    },
    {
      id: "dependency-contradiction",
      session: dependencySession,
      expected: { fieldId: "transport_home", kind: "contradiction" }
    },
    {
      id: "unsupported-imported-claim",
      session: unsupportedSession,
      expected: { fieldId: "child_name", kind: "unsupported_claim" }
    },
    {
      id: "invalid-canonical-type",
      session: invalidSession,
      expected: { fieldId: "will_attend", kind: "invalid_value" }
    },
    {
      id: "missing-render-target",
      session: createFormSession(renderForm, START),
      expected: { fieldId: "child_name", kind: "render_target_missing" }
    }
  ];
}

export async function loadSemanticVerificationFixtures(): Promise<SemanticVerificationFixture[]> {
  const fixtures = await loadGoldenCompilerFixtures();
  const medical = fixtures.find((fixture) => fixture.id === "medical-intake-pdf")!.form;
  const activity = fixtures.find((fixture) => fixture.id === "activity-permission-conditional")!.form;

  const contradiction = answerSequence(medical, [
    ["patient_name", "Jordan Lee"],
    ["date_of_birth", "1990-05-04"],
    ["phone", "+31 20 555 0188"],
    ["visit_reason", "A routine check-up"],
    ["has_allergies", "Yes"],
    ["allergy_details", "No known allergies"]
  ]);
  const unsupportedBase = answerSequence(medical, [
    ["patient_name", "Jordan Lee"],
    ["date_of_birth", "1990-05-04"],
    ["phone", "+31 20 555 0188"],
    ["visit_reason", "I have been coughing for a few days and do not know what it is"],
    ["has_allergies", "No"]
  ]);
  const unsupported = replaceAnswerRecord(unsupportedBase, "visit_reason", {
    value: "Confirmed diagnosis of pneumonia",
    normalizedAnswer: "Confirmed diagnosis of pneumonia"
  });
  const ambiguous = answerSequence(activity, [
    ["child_name", "Mila Hart"],
    ["guardian_name", "Alex Hart"],
    ["guardian_phone", "+31 6 12345678"],
    ["will_attend", "No"],
    ["accessibility_needs", "Some"],
    ["photo_consent", "No"]
  ]);

  return [
    {
      id: "semantic-allergy-contradiction",
      session: contradiction,
      expectedKind: "contradiction",
      expectedFieldIds: ["has_allergies", "allergy_details"]
    },
    {
      id: "semantic-unsupported-diagnosis",
      session: unsupported,
      expectedKind: "unsupported_claim",
      expectedFieldIds: ["visit_reason"]
    },
    {
      id: "semantic-ambiguous-support-needs",
      session: ambiguous,
      expectedKind: "ambiguous_answer",
      expectedFieldIds: ["accessibility_needs"]
    }
  ];
}

function answerSequence(
  form: Parameters<typeof createFormSession>[0],
  answers: Array<[fieldId: string, value: string]>
): FormSession {
  return answers.reduce(
    (session, [fieldId, value], index) => saveTextAnswer(
      session,
      fieldId,
      value,
      new Date(START.valueOf() + ((index + 1) * 1_000))
    ),
    createFormSession(form, START)
  );
}

function replaceAnswerRecord(
  session: FormSession,
  fieldId: string,
  patch: Partial<FormSession["answers"][string]>
): FormSession {
  const timestamp = new Date(START.valueOf() + ((session.version + 1) * 1_000)).toISOString();
  return formSessionSchema.parse({
    ...session,
    version: session.version + 1,
    updatedAt: timestamp,
    answers: {
      ...session.answers,
      [fieldId]: {
        ...session.answers[fieldId],
        ...patch,
        updatedAt: timestamp
      }
    }
  });
}
