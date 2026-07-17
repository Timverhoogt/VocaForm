import {
  webFormDeliveryPlanSchema,
  type FormSession,
  type WebFormDeliveryPlan,
  type WebFormFallbackReason
} from "../domain/schemas";
import { isWebFormDefinition, listFormFields } from "../domain/form_definition";
import { supportsNativeWebFormPreparation } from "./web_form_support";

export const MINIMUM_NATIVE_WEB_FORM_CONFIDENCE = 0.85;

export interface WebFormDeliveryOptions {
  nativePreparationAllowed?: boolean;
  runtimeFallbackReason?: WebFormFallbackReason | null;
}

export function buildWebFormDeliveryPlan(
  session: FormSession,
  options: WebFormDeliveryOptions = {}
): WebFormDeliveryPlan {
  if (!isWebFormDefinition(session.form)) {
    throw new Error("The web-form delivery adapter requires a web-form session.");
  }
  const form = session.form;
  const blockedFieldIds = listFormFields(form)
    .filter((field) => field.support.status === "unsupported"
      || field.deliveryTargets.length === 0
      || !supportsNativeWebFormPreparation(field.type, form.source.provider))
    .map((field) => field.id);
  const targetConfidences = listFormFields(form)
    .filter((field) => field.support.status === "supported")
    .flatMap((field) => field.deliveryTargets.map((target) => target.confidence));
  const nativeConfidence = targetConfidences.length === 0 ? 0 : Math.min(...targetConfidences);
  const unstableLocator = listFormFields(form).some((field) =>
    field.support.status === "supported" && field.deliveryTargets.some((target) =>
      target.confidence < MINIMUM_NATIVE_WEB_FORM_CONFIDENCE
      || !target.locatorCandidates.some((candidate) => candidate.stability !== "low")
    )
  );
  const incompleteCoverage = form.flow.coverage !== "complete";
  const hasSubmitBoundary = form.flow.edges.some((edge) => edge.kind === "submit");
  const multiPage = form.flow.pages.length > 1;
  const nativePreparationAllowed = options.nativePreparationAllowed ?? true;
  const fallbackReason = deliveryFallbackReason({
    nativePreparationAllowed,
    runtimeFallbackReason: options.runtimeFallbackReason ?? null,
    incompleteCoverage,
    multiPage,
    blockedFieldIds,
    unstableLocator,
    hasSubmitBoundary
  });
  const canPrepareNativeForm = nativePreparationAllowed
    && options.runtimeFallbackReason == null
    && !incompleteCoverage
    && blockedFieldIds.length === 0
    && !unstableLocator
    && hasSubmitBoundary
    && form.flow.pages.length === 1;
  const limitation = fallbackReason === "external_authentication"
    ? " The signed-in provider session stays in your browser, so VocaForm uses a manual answer-list hand-off."
    : fallbackReason === "native_preparation_disabled"
      ? " Native preparation is disabled for this deployment; the reviewed manual hand-off remains available."
    : options.runtimeFallbackReason
      ? " Provider confidence is insufficient for native preparation, so the reviewed manual answer list is used."
    : incompleteCoverage
      ? " Only the inspected provider page is included; continue through any later pages manually."
    : multiPage
      ? " Multi-page provider preparation remains a guided manual hand-off."
      : "";
  const blocked = blockedFieldIds.length > 0
    ? ` ${blockedFieldIds.length} ${blockedFieldIds.length === 1 ? "control needs" : "controls need"} manual attention.`
    : "";

  return webFormDeliveryPlanSchema.parse({
    channel: "web_form",
    kind: "native_web_form",
    provider: form.source.provider,
    mode: canPrepareNativeForm ? "browser_handoff" : "guided_manual",
    submission: "user_only",
    sourceRevisionFingerprint: form.source.revision.fingerprint,
    blockedFieldIds,
    fallbackReason: canPrepareNativeForm ? null : fallbackReason,
    nativeConfidence,
    buttonLabel: canPrepareNativeForm
      ? "Prepare native form"
      : nativePreparationAllowed ? "Open original form" : "Open signed-in form",
    description: canPrepareNativeForm
      ? "After your specific consent, VocaForm can place and verify these answers in an isolated provider form. Only you can perform the final Submit action."
      : `Use the reviewed answer list beside the original form. VocaForm has not filled or submitted any provider control.${limitation}${blocked}`
  });
}

function deliveryFallbackReason(input: {
  nativePreparationAllowed: boolean;
  runtimeFallbackReason: WebFormFallbackReason | null;
  incompleteCoverage: boolean;
  multiPage: boolean;
  blockedFieldIds: string[];
  unstableLocator: boolean;
  hasSubmitBoundary: boolean;
}): WebFormFallbackReason | null {
  if (input.runtimeFallbackReason) return input.runtimeFallbackReason;
  if (!input.nativePreparationAllowed) return "external_authentication";
  if (input.incompleteCoverage) return "incomplete_inspection";
  if (input.multiPage) return "multi_page_flow";
  if (input.blockedFieldIds.length > 0) return "unsupported_control";
  if (input.unstableLocator) return "unstable_locator";
  if (!input.hasSubmitBoundary) return "missing_submit_boundary";
  return null;
}
