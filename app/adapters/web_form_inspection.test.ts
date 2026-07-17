import { describe, expect, it } from "vitest";
import { decideWebFormRequest } from "./web_form_browser";
import { finalizeWebFormInspection, type RawWebFormInspection } from "./web_form_inspection";
import {
  detectWebFormProvider,
  isProviderAssetUrlAllowed,
  prepareWebFormUrl
} from "./web_form_url_policy";

describe("web form URL policy", () => {
  it("recognizes responder links and removes Google prefill parameters", () => {
    const prepared = prepareWebFormUrl(
      "https://docs.google.com/forms/d/e/example/viewform?usp=pp_url&entry.123=private#response"
    );

    expect(prepared.provider).toBe("google_forms");
    expect(prepared.url.href).toBe("https://docs.google.com/forms/d/e/example/viewform");
    expect(prepared.queryParametersRemoved).toBe(true);
    expect(detectWebFormProvider("https://forms.gle/example")).toBe("google_forms");
  });

  it("retains only Microsoft responder parameters needed to open shared forms", () => {
    const prepared = prepareWebFormUrl(
      "https://forms.office.com/Pages/ShareFormPage.aspx?id=tenant&sharetoken=token&answer=private"
    );

    expect(prepared.provider).toBe("microsoft_forms");
    expect(prepared.url.searchParams.get("id")).toBe("tenant");
    expect(prepared.url.searchParams.get("sharetoken")).toBe("token");
    expect(prepared.url.searchParams.has("answer")).toBe(false);
    expect(prepared.queryParametersRemoved).toBe(true);
  });

  it("rejects editing, insecure, credential-bearing, and unknown URLs", () => {
    expect(() => prepareWebFormUrl("https://docs.google.com/forms/d/example/edit")).toThrow();
    expect(() => prepareWebFormUrl("http://forms.office.com/r/example")).toThrow();
    expect(() => prepareWebFormUrl("https://person:secret@forms.office.com/r/example")).toThrow();
    expect(() => prepareWebFormUrl("https://example.com/form")).toThrow();
  });

  it("matches exact provider asset suffixes without accepting lookalike hosts", () => {
    expect(isProviderAssetUrlAllowed("google_forms", "https://fonts.gstatic.com/font.woff2")).toBe(true);
    expect(isProviderAssetUrlAllowed("microsoft_forms", "https://res-1.cdn.office.net/app.js")).toBe(true);
    expect(isProviderAssetUrlAllowed("google_forms", "https://google.com.attacker.example/app.js")).toBe(false);
    expect(isProviderAssetUrlAllowed("microsoft_forms", "http://forms.office.com/app.js")).toBe(false);
  });

  it("blocks write methods and sanitizes main-frame navigation before it reaches Chromium", () => {
    expect(decideWebFormRequest({
      provider: "google_forms",
      method: "POST",
      url: "https://docs.google.com/forms/d/e/example/formResponse",
      mainFrameNavigation: false
    })).toEqual({ action: "abort" });
    expect(decideWebFormRequest({
      provider: "google_forms",
      method: "GET",
      url: "https://docs.google.com/forms/d/e/example/viewform?entry.1=private",
      mainFrameNavigation: true
    })).toEqual({
      action: "continue",
      sanitizedUrl: "https://docs.google.com/forms/d/e/example/viewform"
    });
    expect(decideWebFormRequest({
      provider: "microsoft_forms",
      method: "GET",
      url: "https://attacker.example/script.js",
      mainFrameNavigation: false
    })).toEqual({ action: "abort" });
  });
});

describe("web form inspection metrics", () => {
  it("normalizes questions, measures coverage, and reports duplicate identifiers", () => {
    const raw: RawWebFormInspection = {
      provider: "google_forms",
      title: " Example form ",
      description: null,
      sections: ["Details", "Details"],
      questions: [
        {
          providerFieldId: "entry.1",
          label: "Full name",
          description: null,
          type: "short_text",
          required: true,
          options: [],
          sectionTitle: "Details",
          locatorCandidates: [{ kind: "provider_id", value: "entry.1", stability: "medium" }]
        },
        {
          providerFieldId: "entry.1",
          label: "",
          description: null,
          type: "unknown",
          required: false,
          options: ["One", "One", "Two"],
          sectionTitle: "Details",
          locatorCandidates: []
        }
      ],
      hasNextPage: true,
      warnings: []
    };

    const inspection = finalizeWebFormInspection(raw);

    expect(inspection.title).toBe("Example form");
    expect(inspection.sections).toEqual(["Details"]);
    expect(inspection.questions[1]?.options).toEqual(["One", "Two"]);
    expect(inspection.metrics).toMatchObject({
      questionCount: 2,
      requiredQuestionCount: 1,
      unsupportedQuestionCount: 1,
      labelCoveragePercent: 50,
      recognizedTypeCoveragePercent: 50,
      providerIdCoveragePercent: 100,
      usableLocatorCoveragePercent: 50
    });
    expect(inspection.capabilities).toMatchObject({
      readOnly: true,
      submissionBlocked: true,
      questionValuesRead: false,
      currentPageOnly: true
    });
    expect(inspection.warnings.some((warning) => warning.includes("appears more than once"))).toBe(true);
  });
});
