import {
  webFormDefinitionSchema,
  webFormFieldSchema,
  type WebFormDefinition,
  type WebFormField
} from "../domain/schemas";

const URL_FINGERPRINT = "a".repeat(64);
const REVISION_FINGERPRINT = "b".repeat(64);

export function buildWebFormDomainFixture(): WebFormDefinition {
  const requestFields = [
    field("contact_method", "Preferred contact method", "single_choice", "page_1", {
      options: ["Email", "Phone"]
    }),
    field("start_time", "Preferred start time", "time", "page_1"),
    field("confidence", "Confidence", "scale", "page_1", {
      validation: { minValue: 1, maxValue: 5 }
    })
  ];
  const preferenceFields = [
    field("service_rating", "Service rating", "rating", "page_2", {
      validation: { minValue: 1, maxValue: 5 }
    }),
    field("priorities", "Rank priorities", "ranking", "page_2", {
      options: ["Speed", "Cost", "Accessibility"]
    }),
    field("availability", "Availability", "matrix", "page_2", {
      options: ["Morning", "Afternoon"],
      matrixRows: ["Monday", "Tuesday"],
      matrixColumns: ["Morning", "Afternoon"]
    }),
    field("supporting_file", "Supporting file", "file_upload", "page_2", {
      supported: false,
      unsupportedReason: "File uploads require an authenticated provider session and explicit transfer consent."
    }),
    field("signature_widget", "Provider signature widget", "unsupported", "page_2", {
      supported: false,
      unsupportedReason: "The provider-specific signature widget has no deterministic canonical control."
    })
  ];

  return webFormDefinitionSchema.parse({
    id: "community_service_request",
    version: "web-inspection-1",
    title: "Community service request",
    locale: "en-US",
    source: {
      kind: "web_form",
      provider: "google_forms",
      responderOrigin: "https://docs.google.com/",
      urlFingerprint: URL_FINGERPRINT,
      revision: {
        fingerprint: REVISION_FINGERPRINT,
        observedAt: "2026-07-17T08:00:00.000Z",
        providerRevision: null,
        questionCount: requestFields.length + preferenceFields.length,
        pageCount: 2
      }
    },
    prefillFields: [],
    sections: [
      { id: "request", title: "Request", fields: requestFields },
      { id: "preferences", title: "Preferences", fields: preferenceFields }
    ],
    flow: {
      entryPageId: "page_1",
      coverage: "complete",
      pages: [
        {
          id: "page_1",
          ordinal: 1,
          title: "Request",
          sectionIds: ["request"],
          fieldIds: requestFields.map((item) => item.id)
        },
        {
          id: "page_2",
          ordinal: 2,
          title: "Preferences",
          sectionIds: ["preferences"],
          fieldIds: preferenceFields.map((item) => item.id)
        }
      ],
      edges: [
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
          toPageId: "page_2",
          condition: null
        },
        {
          id: "finish",
          kind: "submit",
          fromPageId: "page_2",
          toPageId: null,
          condition: null
        }
      ]
    }
  });
}

function field(
  id: string,
  label: string,
  type: WebFormField["type"],
  pageId: string,
  options: {
    options?: string[];
    matrixRows?: string[];
    matrixColumns?: string[];
    validation?: { minValue: number; maxValue: number };
    supported?: boolean;
    unsupportedReason?: string;
  } = {}
): WebFormField {
  const supported = options.supported ?? true;
  const providerFieldId = `provider_${id}`;
  return webFormFieldSchema.parse({
    id,
    label,
    type,
    required: type !== "file_upload" && type !== "unsupported",
    interviewPrompt: `What should be entered for ${label}?`,
    examples: [],
    options: options.options ?? [],
    dependencies: [],
    validation: {
      minLength: null,
      maxLength: null,
      minValue: options.validation?.minValue ?? null,
      maxValue: options.validation?.maxValue ?? null,
      pattern: null,
      allowedValues: options.options ?? []
    },
    memoryKey: null,
    memoryCandidateReason: null,
    sensitivity: type === "file_upload" ? "sensitive" : "standard",
    evidence: [{ kind: "field", text: label, page: pageId === "page_1" ? 1 : 2, confidence: 1 }],
    pageId,
    providerFieldId,
    sourceControlType: type,
    matrixRows: options.matrixRows ?? [],
    matrixColumns: options.matrixColumns ?? [],
    support: supported
      ? { status: "supported", reason: null }
      : { status: "unsupported", reason: options.unsupportedReason },
    deliveryTargets: supported ? [{
      kind: "web_control",
      providerFieldId,
      locatorCandidates: [{ kind: "provider_id", value: providerFieldId, stability: "high" }],
      confidence: 1
    }] : [],
    deliveryFallback: supported ? "guided_manual" : "blocked"
  });
}
