import type {
  CompilationReadiness,
  DocumentDeliveryPlan,
  FormDefinition,
  FormField,
  FormSession,
  MemoryClaim,
  WebFormAccess,
  WebFormDeliveryPlan,
  WebFormPreparation,
  VerificationResult
} from "../domain/schemas";
import type { SessionMemoryContext } from "../domain/memory";
import type { SessionSummary } from "../domain/session";

export type DocumentDeliveryKind = DocumentDeliveryPlan["kind"];

/** @deprecated Use DocumentDeliveryKind at the delivery boundary. */
export type ExportDocumentKind = DocumentDeliveryKind;

/** @deprecated Compatibility shape returned by the legacy document renderer. */
export interface DocumentExportPlan {
  kind: ExportDocumentKind;
  sourceAvailable: boolean;
  sourceFileName: string;
  buttonLabel: string;
  description: string;
}

export type DeliveryPlan = DocumentDeliveryPlan | WebFormDeliveryPlan;

export interface HealthPayload {
  status: "ok";
  version: string;
  deployment: {
    publicDemo: boolean;
    storage: "local" | "ephemeral";
  };
  openai: {
    configured: boolean;
    model: string;
    realtimeModel: string;
    verificationModel: string;
    verificationMode: "standard" | "pro";
  };
}

export interface FixtureSummary {
  id: string;
  title: string;
  description: string;
  format: "docx" | "pdf" | "text" | "fixture";
}

export interface SessionView {
  session: FormSession;
  summary: SessionSummary;
  verification: VerificationResult;
  nextField: FormField | null;
  memory: SessionMemoryContext;
  deliveryPlan: DeliveryPlan;
  webForm: {
    access: WebFormAccess;
    handoffUrl: string;
    warnings: string[];
    preparation: WebFormPreparation;
  } | null;
}

export interface MemoryVaultView {
  version: number;
  claims: MemoryClaim[];
  updatedAt: string;
}

export interface MemoryMutationResponse {
  memory: MemoryVaultView;
  view: SessionView | null;
}

export interface CompilationResult {
  id: string;
  form: FormDefinition | null;
  documentSummary: string;
  readiness: CompilationReadiness;
  metadata: {
    model: string;
    responseId: string;
    compiledAt: string;
    byteLength: number;
    visualStrategy: "direct_pdf" | "docx_visual_pdf" | "plain_text";
    originalRetained: boolean;
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

export interface InterviewToolResponse {
  output: {
    ok: boolean;
    tool: string;
    sessionVersion: number;
    [key: string]: unknown;
  };
  view: SessionView;
  cached: boolean;
}
