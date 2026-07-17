import { describe, expect, it } from "vitest";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import { buildWebFormDomainFixture } from "../evals/web_form_domain_fixture";
import {
  deliveryTargetsForField,
  isDocumentFormDefinition,
  isWebFormDefinition,
  listFormFields
} from "./form_definition";
import { saveVoiceAnswers } from "./interview";
import {
  formDefinitionSchema,
  webFormDeliveryPlanSchema,
  webFormDefinitionSchema
} from "./schemas";
import {
  createFormSession,
  findField,
  isFieldApplicable,
  saveTextAnswer,
  summarizeSession,
  verifySession
} from "./session";

describe("provider-independent web-form contracts", () => {
  it("represents revisions, provider IDs, pages, branching, and delivery targets without browser state", () => {
    const form = buildWebFormDomainFixture();
    const fields = listFormFields(form);

    expect(isWebFormDefinition(form)).toBe(true);
    expect(form.source).toMatchObject({
      kind: "web_form",
      provider: "google_forms",
      responderOrigin: "https://docs.google.com/",
      revision: { questionCount: 8, pageCount: 2 }
    });
    expect(form.flow).toMatchObject({ entryPageId: "page_1", coverage: "complete" });
    expect(form.flow.edges.map((edge) => edge.kind)).toEqual(["conditional", "next", "submit"]);
    expect(new Set(fields.map((field) => field.providerFieldId)).size).toBe(8);
    expect(fields
      .filter((field) => field.support.status === "supported")
      .every((field) => deliveryTargetsForField(field).length > 0)).toBe(true);
    expect(fields.map((field) => field.type)).toEqual(expect.arrayContaining([
      "time",
      "scale",
      "rating",
      "ranking",
      "matrix",
      "file_upload",
      "unsupported"
    ]));
  });

  it("rejects internally inconsistent source revisions and page assignments", () => {
    const wrongRevision = structuredClone(buildWebFormDomainFixture());
    wrongRevision.source.revision.questionCount = 99;
    expect(webFormDefinitionSchema.safeParse(wrongRevision).success).toBe(false);

    const missingPlacement = structuredClone(buildWebFormDomainFixture());
    missingPlacement.flow.pages[1]!.fieldIds = missingPlacement.flow.pages[1]!.fieldIds
      .filter((fieldId) => fieldId !== "availability");
    expect(webFormDefinitionSchema.safeParse(missingPlacement).success).toBe(false);

    const duplicateProviderId = structuredClone(buildWebFormDomainFixture());
    duplicateProviderId.sections[1]!.fields[0]!.providerFieldId = "provider_contact_method";
    expect(webFormDefinitionSchema.safeParse(duplicateProviderId).success).toBe(false);
  });

  it("validates time, scale, rating, ranking, and structured matrix answers", () => {
    let session = createFormSession(buildWebFormDomainFixture(), new Date("2026-07-17T08:00:00.000Z"));
    session = saveTextAnswer(session, "start_time", "14:30");
    session = saveTextAnswer(session, "confidence", "4");
    session = saveTextAnswer(session, "service_rating", "5");
    session = saveTextAnswer(session, "priorities", ["Accessibility", "Speed", "Cost"]);
    session = saveVoiceAnswers(session, [{
      fieldId: "availability",
      value: { Monday: "Morning", Tuesday: "Afternoon" },
      rawAnswer: "Monday morning and Tuesday afternoon.",
      confidence: 1
    }], new Date("2026-07-17T08:01:00.000Z"));

    expect(session.answers).toMatchObject({
      start_time: { value: "14:30" },
      confidence: { value: 4 },
      service_rating: { value: 5 },
      priorities: { value: ["Accessibility", "Speed", "Cost"] },
      availability: {
        value: { Monday: "Morning", Tuesday: "Afternoon" },
        normalizedAnswer: "Monday: Morning; Tuesday: Afternoon"
      }
    });
    expect(() => saveTextAnswer(session, "start_time", "25:00")).toThrow("24-hour time");
    expect(() => saveTextAnswer(session, "confidence", "9")).toThrow("above the allowed maximum");
    expect(() => saveTextAnswer(session, "priorities", ["Speed", "Speed"]))
      .toThrow("repeats a ranked choice");
  });

  it("keeps unsupported native controls as non-resolvable verification blockers", () => {
    const session = createFormSession(buildWebFormDomainFixture());
    const verification = verifySession(session);
    const blockers = verification.issues.filter((issue) => issue.kind === "unsupported_control");

    expect(blockers.map((issue) => issue.fieldId)).toEqual(["supporting_file", "signature_widget"]);
    expect(blockers.every((issue) => issue.severity === "blocker" && !issue.resolved)).toBe(true);
    expect(verification.readyForFinalExport).toBe(false);
    expect(() => saveTextAnswer(session, "supporting_file", "private-file.pdf"))
      .toThrow("cannot be answered safely");
  });

  it("defines a user-only web delivery plan with explicit blocked fields", () => {
    const form = buildWebFormDomainFixture();
    const plan = webFormDeliveryPlanSchema.parse({
      channel: "web_form",
      kind: "native_web_form",
      provider: form.source.provider,
      mode: "guided_manual",
      submission: "user_only",
      sourceRevisionFingerprint: form.source.revision.fingerprint,
      blockedFieldIds: ["priorities", "availability", "supporting_file", "signature_widget"],
      buttonLabel: "Review native form",
      description: "Prepare supported controls and leave submission to the user."
    });

    expect(plan.submission).toBe("user_only");
    expect(plan.blockedFieldIds).toHaveLength(4);
  });

  it("follows deterministic forward-only branches without interviewing excluded pages", () => {
    const form = buildBranchingFixture();
    const serviceRating = findField(form, "service_rating")!;
    const priorities = findField(form, "priorities")!;

    const emailPath = saveTextAnswer(createFormSession(form), "contact_method", "Email");
    expect(isFieldApplicable(emailPath, serviceRating)).toBe(true);
    expect(isFieldApplicable(emailPath, priorities)).toBe(false);
    expect(summarizeSession(emailPath).handledFields).toBeGreaterThan(1);

    const phonePath = saveTextAnswer(createFormSession(form), "contact_method", "Phone");
    expect(isFieldApplicable(phonePath, serviceRating)).toBe(false);
    expect(isFieldApplicable(phonePath, priorities)).toBe(true);
    expect(() => saveTextAnswer(phonePath, "service_rating", "5"))
      .toThrow("not currently applicable");
  });

  it("keeps backward or unresolved complete branching visibly blocked", () => {
    const form = buildBranchingFixture();
    form.flow.edges[0] = {
      id: "backward_branch",
      kind: "conditional",
      fromPageId: "page_2",
      toPageId: "page_1",
      condition: { fieldId: "contact_method", operator: "equals", value: "Email" }
    };

    const verification = verifySession(createFormSession(form));
    expect(verification.issues.some((issue) => issue.kind === "unsupported_flow")).toBe(true);
  });
});

describe("document contract compatibility", () => {
  it("parses every existing document fixture without adding or removing properties", async () => {
    const fixtures = await loadGoldenCompilerFixtures();
    for (const fixture of fixtures) {
      const before = structuredClone(fixture.form);
      const parsed = formDefinitionSchema.parse(before);

      expect(isDocumentFormDefinition(parsed)).toBe(true);
      expect(parsed).toEqual(before);
      expect(listFormFields(parsed).map(deliveryTargetsForField))
        .toEqual(listFormFields(fixture.form).map((field) => field.renderTargets));
    }
  });
});

function buildBranchingFixture() {
  const form = structuredClone(buildWebFormDomainFixture());
  const preferences = form.sections[1]!;
  const [serviceRating, ...manualPathFields] = preferences.fields;
  for (const field of manualPathFields) field.pageId = "page_3";
  form.source.revision.pageCount = 3;
  form.flow.pages = [
    form.flow.pages[0]!,
    {
      id: "page_2",
      ordinal: 2,
      title: "Email follow-up",
      sectionIds: [preferences.id],
      fieldIds: [serviceRating!.id]
    },
    {
      id: "page_3",
      ordinal: 3,
      title: "Manual follow-up",
      sectionIds: [preferences.id],
      fieldIds: manualPathFields.map((field) => field.id)
    }
  ];
  form.flow.edges = [
    {
      id: "email_branch",
      kind: "conditional",
      fromPageId: "page_1",
      toPageId: "page_2",
      condition: { fieldId: "contact_method", operator: "equals", value: "Email" }
    },
    {
      id: "default_next",
      kind: "next",
      fromPageId: "page_1",
      toPageId: "page_3",
      condition: null
    },
    {
      id: "email_finish",
      kind: "submit",
      fromPageId: "page_2",
      toPageId: null,
      condition: null
    },
    {
      id: "manual_finish",
      kind: "submit",
      fromPageId: "page_3",
      toPageId: null,
      condition: null
    }
  ];
  return webFormDefinitionSchema.parse(form);
}
