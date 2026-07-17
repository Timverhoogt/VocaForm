import { z } from "zod";
import { canonicalizeLocale } from "./locale";

export const localeSchema = z.string().trim().min(2).transform((value, context) => {
  const canonical = canonicalizeLocale(value);
  if (canonical) return canonical;
  context.addIssue({
    code: "custom",
    message: "Locale must be a valid BCP 47 language tag."
  });
  return z.NEVER;
});

export const fieldTypeSchema = z.enum([
  "short_text",
  "long_text",
  "email",
  "phone",
  "date",
  "time",
  "number",
  "boolean",
  "single_choice",
  "multi_choice",
  "scale",
  "rating",
  "ranking",
  "matrix",
  "file_upload",
  "unsupported"
]);

export const sourceEvidenceSchema = z.object({
  kind: z.enum(["text", "page", "field"]),
  text: z.string().min(1),
  page: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1)
});

export const documentDeliveryTargetSchema = z.object({
  kind: z.enum(["docx_anchor", "pdf_field", "answer_packet"]),
  locator: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

// Kept as a compatibility alias while the document compiler and renderer are
// migrated behind the provider-independent delivery boundary.
export const renderTargetSchema = documentDeliveryTargetSchema;

export const webFormLocatorSchema = z.object({
  kind: z.enum(["provider_id", "accessible_label"]),
  value: z.string().min(1),
  stability: z.enum(["high", "medium", "low"])
});

export const webFormDeliveryTargetSchema = z.object({
  kind: z.literal("web_control"),
  providerFieldId: z.string().min(1),
  locatorCandidates: z.array(webFormLocatorSchema).min(1),
  confidence: z.number().min(0).max(1)
});

export const deliveryTargetSchema = z.union([
  documentDeliveryTargetSchema,
  webFormDeliveryTargetSchema
]);

export const fieldDependencySchema = z.object({
  fieldId: z.string().min(1),
  operator: z.enum(["equals", "not_equals", "includes", "is_present"]),
  value: z.string().nullable()
});

export const validationConstraintSchema = z.object({
  minLength: z.number().int().nonnegative().nullable(),
  maxLength: z.number().int().positive().nullable(),
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
  pattern: z.string().min(1).nullable(),
  allowedValues: z.array(z.string())
});

export const formFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: fieldTypeSchema,
  required: z.boolean(),
  interviewPrompt: z.string().min(1),
  examples: z.array(z.string()),
  options: z.array(z.string()),
  dependencies: z.array(fieldDependencySchema),
  validation: validationConstraintSchema,
  memoryKey: z.string().min(1).nullable(),
  memoryCandidateReason: z.string().min(1).nullable(),
  sensitivity: z.enum(["standard", "sensitive", "restricted"]),
  evidence: z.array(sourceEvidenceSchema),
  renderTargets: z.array(renderTargetSchema),
  renderFallback: z.enum(["append_answer_packet", "manual_review"])
});

export const formSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  fields: z.array(formFieldSchema)
});

export const webFormControlSupportSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("supported"),
    reason: z.null()
  }),
  z.object({
    status: z.literal("unsupported"),
    reason: z.string().min(1)
  })
]);

export const webFormFieldSchema = formFieldSchema
  .omit({ renderTargets: true, renderFallback: true })
  .extend({
    pageId: z.string().min(1),
    providerFieldId: z.string().min(1),
    sourceControlType: z.string().min(1),
    matrixRows: z.array(z.string().min(1)),
    matrixColumns: z.array(z.string().min(1)),
    support: webFormControlSupportSchema,
    deliveryTargets: z.array(webFormDeliveryTargetSchema),
    deliveryFallback: z.enum(["guided_manual", "blocked"])
  })
  .superRefine((field, context) => {
    const mismatchedTarget = field.deliveryTargets.some(
      (target) => target.providerFieldId !== field.providerFieldId
    );
    if (mismatchedTarget) {
      context.addIssue({
        code: "custom",
        path: ["deliveryTargets"],
        message: "Every web control target must use the field's provider identifier."
      });
    }
    if (field.support.status === "supported" && field.deliveryTargets.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["deliveryTargets"],
        message: "A supported web control requires at least one delivery target."
      });
    }
    if (field.support.status === "unsupported"
      && (field.deliveryTargets.length > 0 || field.deliveryFallback !== "blocked")) {
      context.addIssue({
        code: "custom",
        path: ["support"],
        message: "Unsupported web controls must remain blocked and cannot expose delivery targets."
      });
    }
    if (field.type === "unsupported" && field.support.status !== "unsupported") {
      context.addIssue({
        code: "custom",
        path: ["support"],
        message: "An unsupported field type must carry an explicit unsupported-control reason."
      });
    }
  });

export const webFormSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  fields: z.array(webFormFieldSchema)
});

export const prefillFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  memoryKey: z.string().min(1)
});

export const documentFormSourceSchema = z.object({
  fileName: z.string().min(1),
  format: z.enum(["docx", "pdf", "text", "fixture"])
});

export const webFormProviderSchema = z.enum(["google_forms", "microsoft_forms"]);
export const webFormAccessSchema = z.enum(["public", "external"]);
export const webFormFallbackReasonSchema = z.enum([
  "native_preparation_disabled",
  "external_authentication",
  "incomplete_inspection",
  "multi_page_flow",
  "unsupported_control",
  "unstable_locator",
  "missing_submit_boundary",
  "provider_drift",
  "stale_answers",
  "expired_session",
  "interrupted",
  "verification_failed",
  "provider_throttled",
  "resource_limited"
]);

export const webFormSourceRevisionSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.string().datetime(),
  providerRevision: z.string().min(1).nullable(),
  questionCount: z.number().int().nonnegative(),
  pageCount: z.number().int().positive()
});

export const webFormSourceSchema = z.object({
  kind: z.literal("web_form"),
  provider: webFormProviderSchema,
  responderOrigin: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.href === `${url.origin}/`;
  }, "Responder origin must be an HTTPS origin without a path, query, or fragment."),
  urlFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  revision: webFormSourceRevisionSchema
});

export const webFormPageSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().positive(),
  title: z.string().min(1).nullable(),
  sectionIds: z.array(z.string().min(1)),
  fieldIds: z.array(z.string().min(1))
});

const webFormNextEdgeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("next"),
  fromPageId: z.string().min(1),
  toPageId: z.string().min(1),
  condition: z.null()
});

const webFormConditionalEdgeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("conditional"),
  fromPageId: z.string().min(1),
  toPageId: z.string().min(1),
  condition: fieldDependencySchema
});

const webFormSubmitEdgeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("submit"),
  fromPageId: z.string().min(1),
  toPageId: z.null(),
  condition: z.null()
});

const webFormUnknownEdgeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("unknown"),
  fromPageId: z.string().min(1),
  toPageId: z.null(),
  condition: fieldDependencySchema.nullable()
});

export const webFormFlowEdgeSchema = z.discriminatedUnion("kind", [
  webFormNextEdgeSchema,
  webFormConditionalEdgeSchema,
  webFormSubmitEdgeSchema,
  webFormUnknownEdgeSchema
]);

export const webFormFlowSchema = z.object({
  entryPageId: z.string().min(1),
  coverage: z.enum(["complete", "current_page_only"]),
  pages: z.array(webFormPageSchema).min(1),
  edges: z.array(webFormFlowEdgeSchema)
});

export const documentFormDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  locale: localeSchema,
  source: documentFormSourceSchema,
  prefillFields: z.array(prefillFieldSchema).default([]),
  sections: z.array(formSectionSchema).min(1)
});

export const webFormDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  locale: localeSchema,
  source: webFormSourceSchema,
  prefillFields: z.array(prefillFieldSchema).default([]),
  sections: z.array(webFormSectionSchema).min(1),
  flow: webFormFlowSchema
}).superRefine((form, context) => {
  const fields = form.sections.flatMap((section) => section.fields);
  const fieldIds = new Set(fields.map((field) => field.id));
  const sectionIds = new Set(form.sections.map((section) => section.id));
  const pageIds = new Set(form.flow.pages.map((page) => page.id));

  addDuplicateIssues(form.sections.map((section) => section.id), ["sections"], "section", context);
  addDuplicateIssues(fields.map((field) => field.id), ["sections"], "field", context);
  addDuplicateIssues(fields.map((field) => field.providerFieldId), ["sections"], "provider field", context);
  addDuplicateIssues(form.flow.pages.map((page) => page.id), ["flow", "pages"], "page", context);
  addDuplicateIssues(form.flow.edges.map((edge) => edge.id), ["flow", "edges"], "flow edge", context);

  if (!pageIds.has(form.flow.entryPageId)) {
    context.addIssue({
      code: "custom",
      path: ["flow", "entryPageId"],
      message: "The entry page must exist in the declared web-form flow."
    });
  }
  if (form.source.revision.questionCount !== fields.length) {
    context.addIssue({
      code: "custom",
      path: ["source", "revision", "questionCount"],
      message: "The source revision question count must match the canonical fields."
    });
  }
  if (form.source.revision.pageCount !== form.flow.pages.length) {
    context.addIssue({
      code: "custom",
      path: ["source", "revision", "pageCount"],
      message: "The source revision page count must match the declared pages."
    });
  }

  for (const page of form.flow.pages) {
    for (const sectionId of page.sectionIds) {
      if (!sectionIds.has(sectionId)) {
        context.addIssue({
          code: "custom",
          path: ["flow", "pages", page.id, "sectionIds"],
          message: `Page “${page.id}” references an unknown section.`
        });
      }
    }
    for (const fieldId of page.fieldIds) {
      if (!fieldIds.has(fieldId)) {
        context.addIssue({
          code: "custom",
          path: ["flow", "pages", page.id, "fieldIds"],
          message: `Page “${page.id}” references an unknown field.`
        });
      }
    }
  }

  for (const field of fields) {
    const containingPages = form.flow.pages.filter((page) => page.fieldIds.includes(field.id));
    if (containingPages.length !== 1 || containingPages[0]?.id !== field.pageId) {
      context.addIssue({
        code: "custom",
        path: ["sections", field.id, "pageId"],
        message: `Field “${field.id}” must appear once on its declared page.`
      });
    }
  }

  for (const edge of form.flow.edges) {
    if (!pageIds.has(edge.fromPageId)
      || (edge.toPageId !== null && !pageIds.has(edge.toPageId))) {
      context.addIssue({
        code: "custom",
        path: ["flow", "edges", edge.id],
        message: `Flow edge “${edge.id}” references an unknown page.`
      });
    }
    if (edge.condition && !fieldIds.has(edge.condition.fieldId)) {
      context.addIssue({
        code: "custom",
        path: ["flow", "edges", edge.id, "condition"],
        message: `Flow edge “${edge.id}” references an unknown controlling field.`
      });
    }
  }
});

export const formDefinitionSchema = z.union([
  documentFormDefinitionSchema,
  webFormDefinitionSchema
]);

export const documentDeliveryPlanSchema = z.object({
  channel: z.literal("document"),
  kind: z.enum(["filled_docx", "filled_pdf", "answer_packet"]),
  sourceAvailable: z.boolean(),
  sourceFileName: z.string().min(1),
  buttonLabel: z.string().min(1),
  description: z.string().min(1)
});

export const webFormDeliveryPlanSchema = z.object({
  channel: z.literal("web_form"),
  kind: z.literal("native_web_form"),
  provider: webFormProviderSchema,
  mode: z.enum(["guided_manual", "browser_handoff"]),
  submission: z.literal("user_only"),
  sourceRevisionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  blockedFieldIds: z.array(z.string().min(1)),
  fallbackReason: webFormFallbackReasonSchema.nullable().default(null),
  nativeConfidence: z.number().min(0).max(1).default(0),
  buttonLabel: z.string().min(1),
  description: z.string().min(1)
});

export const webFormPlacedControlSchema = z.object({
  fieldId: z.string().min(1),
  fieldLabel: z.string().min(1),
  providerFieldId: z.string().min(1),
  locator: z.string().min(1),
  answerFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  controlFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  normalizedValue: z.union([z.string(), z.array(z.string())]),
  verifiedAt: z.string().datetime()
});

const webFormPreparationBindingSchema = z.object({
  browserSessionId: z.string().uuid(),
  canonicalSessionId: z.string().uuid(),
  canonicalSessionVersion: z.number().int().nonnegative(),
  canonicalSessionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceUrlFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevisionFingerprint: z.string().regex(/^[a-f0-9]{64}$/)
});

export const webFormPreparationNotStartedSchema = z.object({
  status: z.literal("not_started")
});

export const webFormPreparationAwaitingSubmitSchema = webFormPreparationBindingSchema.extend({
  status: z.literal("awaiting_user_submit"),
  preparedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  placedControls: z.array(webFormPlacedControlSchema),
  screenshotVersion: z.number().int().nonnegative()
});

export const webFormPreparationRecoverableSchema = z.object({
  status: z.literal("recoverable"),
  reason: z.enum([
    "expired",
    "interrupted",
    "session_changed",
    "provider_changed",
    "verification_failed",
    "provider_throttled",
    "resource_limited"
  ]),
  message: z.string().min(1),
  retryAllowed: z.literal(true)
});

export const webFormPreparationSubmittedSchema = webFormPreparationBindingSchema.extend({
  status: z.literal("submitted"),
  submittedAt: z.string().datetime(),
  placedControlCount: z.number().int().nonnegative(),
  screenshotVersion: z.number().int().nonnegative()
});

export const webFormPreparationSubmissionUncertainSchema = webFormPreparationBindingSchema.extend({
  status: z.literal("submission_uncertain"),
  attemptedAt: z.string().datetime(),
  placedControlCount: z.number().int().nonnegative(),
  message: z.string().min(1),
  screenshotVersion: z.number().int().nonnegative()
});

export const webFormPreparationSchema = z.discriminatedUnion("status", [
  webFormPreparationNotStartedSchema,
  webFormPreparationAwaitingSubmitSchema,
  webFormPreparationRecoverableSchema,
  webFormPreparationSubmittedSchema,
  webFormPreparationSubmissionUncertainSchema
]);

export const deliveryPlanSchema = z.discriminatedUnion("channel", [
  documentDeliveryPlanSchema,
  webFormDeliveryPlanSchema
]);

export const answerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.union([z.string(), z.array(z.string())]))
]);

export const verificationActionSchema = z.enum(["answer", "confirm", "correct", "leave_blank"]);

export const verificationResolutionSchema = z.object({
  issueId: z.string().min(1),
  action: verificationActionSchema,
  answerFingerprints: z.record(z.string(), z.string()),
  resolvedAt: z.string().datetime()
});

export const answerRecordSchema = z.object({
  fieldId: z.string().min(1),
  status: z.enum(["unanswered", "answered", "needs_followup", "skipped"]),
  value: answerValueSchema.nullable(),
  rawAnswer: z.string().nullable(),
  normalizedAnswer: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  followUpQuestion: z.string().nullable(),
  source: z.enum(["voice", "text", "memory", "import", "user_correction"]),
  memoryClaimId: z.string().uuid().nullable().default(null),
  updatedAt: z.string().datetime()
});

export const formSessionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  form: formDefinitionSchema,
  answers: z.record(z.string(), answerRecordSchema),
  prefillAnswers: z.record(z.string(), answerRecordSchema).default({}),
  verificationResolutions: z.record(z.string(), verificationResolutionSchema).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const memoryClaimSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().min(1),
  key: z.string().min(1),
  value: answerValueSchema,
  originalWording: z.string().min(1),
  sensitivity: z.enum(["standard", "sensitive", "restricted"]),
  sourceFormId: z.string().min(1),
  sourceFieldId: z.string().min(1),
  sourceFormTitle: z.string().min(1).nullable().default(null),
  sourceFormLocale: localeSchema.nullable().default(null),
  sourceFieldLabel: z.string().min(1).nullable().default(null),
  sourceSessionId: z.string().uuid().nullable().default(null),
  sourceAnswerSource: z.enum(["voice", "text", "user_correction"]).nullable().default(null),
  sourceAnsweredAt: z.string().datetime().nullable().default(null),
  consent: z.enum(["proposed", "approved", "denied"]),
  consentChannel: z.enum(["ui", "voice"]).nullable().default(null),
  confirmationWording: z.string().min(1).nullable().default(null),
  confirmedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  correctedAt: z.string().datetime().nullable().default(null)
});

export const memoryVaultSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().nonnegative(),
  claims: z.array(memoryClaimSchema),
  updatedAt: z.string().datetime()
});

export const verificationIssueSchema = z.object({
  id: z.string().min(1),
  fieldId: z.string().min(1).nullable(),
  relatedFieldIds: z.array(z.string().min(1)),
  severity: z.enum(["blocker", "warning"]),
  kind: z.enum([
    "required_missing",
    "required_skipped",
    "needs_followup",
    "low_confidence",
    "invalid_value",
    "unsupported_claim",
    "contradiction",
    "ambiguous_answer",
    "render_target_missing",
    "delivery_target_missing",
    "unsupported_control",
    "unsupported_flow"
  ]),
  message: z.string().min(1),
  evidence: z.string().min(1),
  actions: z.array(verificationActionSchema),
  source: z.enum(["deterministic", "model"]),
  resolved: z.boolean()
});

export const verificationResultSchema = z.object({
  readyForFinalExport: z.boolean(),
  issues: z.array(verificationIssueSchema),
  deterministicIssueCount: z.number().int().nonnegative(),
  semanticStatus: z.enum(["not_run", "unavailable", "passed", "findings", "error"]),
  semanticModel: z.string().min(1).nullable(),
  semanticMode: z.enum(["standard", "pro"]).nullable(),
  verifiedSessionVersion: z.number().int().nonnegative().nullable(),
  checkedAt: z.string().datetime()
});

export const semanticVerificationFindingSchema = z.object({
  kind: z.enum(["unsupported_claim", "contradiction", "ambiguous_answer"]),
  severity: z.enum(["blocker", "warning"]),
  fieldIds: z.array(z.string().min(1)).min(1),
  message: z.string().min(1),
  evidence: z.string().min(1),
  actions: z.array(verificationActionSchema).min(1)
});

export const semanticVerificationOutputSchema = z.object({
  findings: z.array(semanticVerificationFindingSchema)
});

// The canonical section and field schemas intentionally have no optional/defaulted
// properties, so this can be converted directly to strict Structured Outputs.
export const formCompilerOutputSchema = z.object({
  document: z.object({
    isForm: z.boolean(),
    title: z.string().min(1),
    locale: z.string().min(2),
    summary: z.string().min(1)
  }),
  sections: z.array(formSectionSchema),
  warnings: z.array(z.string())
});

export const compilationIssueSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["blocker", "warning"]),
  kind: z.enum([
    "not_a_form",
    "no_fields",
    "invalid_locale",
    "duplicate_id",
    "missing_evidence",
    "unsupported_evidence",
    "low_confidence",
    "invalid_dependency",
    "invalid_validation",
    "choice_without_options",
    "missing_render_target",
    "unsafe_memory_candidate",
    "model_warning"
  ]),
  fieldId: z.string().min(1).nullable(),
  message: z.string().min(1)
});

export const compilationReadinessSchema = z.object({
  ready: z.boolean(),
  score: z.number().int().min(0).max(100),
  fieldCount: z.number().int().nonnegative(),
  requiredFieldCount: z.number().int().nonnegative(),
  evidenceCoveragePercent: z.number().int().min(0).max(100),
  lowConfidenceCount: z.number().int().nonnegative(),
  issues: z.array(compilationIssueSchema)
});

export type AnswerRecord = z.infer<typeof answerRecordSchema>;
export type AnswerValue = z.infer<typeof answerValueSchema>;
export type FieldType = z.infer<typeof fieldTypeSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type DocumentFormDefinition = z.infer<typeof documentFormDefinitionSchema>;
export type WebFormDefinition = z.infer<typeof webFormDefinitionSchema>;
export type DocumentFormField = z.infer<typeof formFieldSchema>;
export type WebFormField = z.infer<typeof webFormFieldSchema>;
export type FormField = DocumentFormField | WebFormField;
export type DocumentFormSection = z.infer<typeof formSectionSchema>;
export type WebFormSection = z.infer<typeof webFormSectionSchema>;
export type FormSection = DocumentFormSection | WebFormSection;
export type DocumentDeliveryTarget = z.infer<typeof documentDeliveryTargetSchema>;
export type WebFormDeliveryTarget = z.infer<typeof webFormDeliveryTargetSchema>;
export type WebFormProvider = z.infer<typeof webFormProviderSchema>;
export type WebFormAccess = z.infer<typeof webFormAccessSchema>;
export type WebFormFallbackReason = z.infer<typeof webFormFallbackReasonSchema>;
export type DeliveryTarget = z.infer<typeof deliveryTargetSchema>;
export type RenderTarget = DocumentDeliveryTarget;
export type DocumentDeliveryPlan = z.infer<typeof documentDeliveryPlanSchema>;
export type WebFormDeliveryPlan = z.infer<typeof webFormDeliveryPlanSchema>;
export type DeliveryPlan = z.infer<typeof deliveryPlanSchema>;
export type WebFormPlacedControl = z.infer<typeof webFormPlacedControlSchema>;
export type WebFormPreparation = z.infer<typeof webFormPreparationSchema>;
export type FormSession = z.infer<typeof formSessionSchema>;
export type FormCompilerOutput = z.infer<typeof formCompilerOutputSchema>;
export type CompilationIssue = z.infer<typeof compilationIssueSchema>;
export type CompilationReadiness = z.infer<typeof compilationReadinessSchema>;
export type FieldDependency = z.infer<typeof fieldDependencySchema>;
export type ValidationConstraint = z.infer<typeof validationConstraintSchema>;
export type MemoryClaim = z.infer<typeof memoryClaimSchema>;
export type MemoryVault = z.infer<typeof memoryVaultSchema>;
export type VerificationIssue = z.infer<typeof verificationIssueSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
export type VerificationAction = z.infer<typeof verificationActionSchema>;
export type VerificationResolution = z.infer<typeof verificationResolutionSchema>;
export type SemanticVerificationFinding = z.infer<typeof semanticVerificationFindingSchema>;
export type SemanticVerificationOutput = z.infer<typeof semanticVerificationOutputSchema>;

function addDuplicateIssues(
  values: string[],
  path: Array<string | number>,
  label: string,
  context: z.core.$RefinementCtx<unknown>
): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  for (const value of new Set(duplicates)) {
    context.addIssue({
      code: "custom",
      path,
      message: `The ${label} identifier “${value}” is duplicated.`
    });
  }
}
