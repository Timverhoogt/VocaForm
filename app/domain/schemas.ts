import { z } from "zod";

export const fieldTypeSchema = z.enum([
  "short_text",
  "long_text",
  "email",
  "phone",
  "date",
  "number",
  "boolean",
  "single_choice",
  "multi_choice"
]);

export const sourceEvidenceSchema = z.object({
  kind: z.enum(["text", "page", "field"]),
  text: z.string().min(1),
  page: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1)
});

export const renderTargetSchema = z.object({
  kind: z.enum(["docx_anchor", "pdf_field", "answer_packet"]),
  locator: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

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

export const prefillFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  memoryKey: z.string().min(1)
});

export const formDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  locale: z.string().min(2),
  source: z.object({
    fileName: z.string().min(1),
    format: z.enum(["docx", "pdf", "text", "fixture"])
  }),
  prefillFields: z.array(prefillFieldSchema).default([]),
  sections: z.array(formSectionSchema).min(1)
});

export const answerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string())
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
    "render_target_missing"
  ]),
  message: z.string().min(1),
  evidence: z.string().min(1),
  actions: z.array(verificationActionSchema).min(1),
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
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormField = z.infer<typeof formFieldSchema>;
export type FormSection = z.infer<typeof formSectionSchema>;
export type RenderTarget = z.infer<typeof renderTargetSchema>;
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
