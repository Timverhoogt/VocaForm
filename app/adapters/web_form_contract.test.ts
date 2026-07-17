import { describe, expect, it } from "vitest";
import { assessWebFormProviderContract } from "./web_form_contract";
import { finalizeWebFormInspection, type RawWebFormInspection } from "./web_form_inspection";

describe("provider web-form contract drift", () => {
  it("accepts a complete deterministic provider boundary", () => {
    const assessment = assessWebFormProviderContract(finalizeWebFormInspection(rawInspection()));

    expect(assessment).toEqual({
      safeForInspection: true,
      safeForNativePreparation: true,
      driftReasons: []
    });
  });

  it("fails native preparation closed when markup, locators, or Submit drift", () => {
    const raw = rawInspection();
    raw.providerSignals = {
      markupBoundaryFound: false,
      questionBoundaryFound: true,
      nextControlFound: false,
      submitControlFound: false
    };
    raw.questions[0]!.locatorCandidates = [];
    const assessment = assessWebFormProviderContract(finalizeWebFormInspection(raw));

    expect(assessment.safeForInspection).toBe(false);
    expect(assessment.safeForNativePreparation).toBe(false);
    expect(assessment.driftReasons).toEqual(expect.arrayContaining([
      "markup_boundary_missing",
      "submit_boundary_missing",
      "locator_coverage_incomplete"
    ]));
  });
});

function rawInspection(): RawWebFormInspection {
  return {
    provider: "google_forms",
    title: "Contract fixture",
    description: null,
    sections: [],
    questions: [{
      providerFieldId: "entry.1",
      label: "Full name",
      description: null,
      type: "short_text",
      required: true,
      options: [],
      sectionTitle: null,
      locatorCandidates: [{ kind: "provider_id", value: "entry.1", stability: "high" }]
    }],
    hasNextPage: false,
    providerSignals: {
      markupBoundaryFound: true,
      questionBoundaryFound: true,
      nextControlFound: false,
      submitControlFound: true
    },
    warnings: []
  };
}
