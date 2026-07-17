import type { WebFormInspection } from "./web_form_inspection";

export type WebFormContractDriftReason =
  | "markup_boundary_missing"
  | "question_boundary_missing"
  | "navigation_boundary_missing"
  | "submit_boundary_missing"
  | "question_structure_missing"
  | "label_coverage_incomplete"
  | "control_type_coverage_incomplete"
  | "provider_id_coverage_incomplete"
  | "locator_coverage_incomplete";

export interface WebFormContractAssessment {
  safeForInspection: boolean;
  safeForNativePreparation: boolean;
  driftReasons: WebFormContractDriftReason[];
}

export function assessWebFormProviderContract(
  inspection: WebFormInspection
): WebFormContractAssessment {
  const driftReasons: WebFormContractDriftReason[] = [];
  const { metrics, providerSignals } = inspection;

  if (!providerSignals.markupBoundaryFound) driftReasons.push("markup_boundary_missing");
  if (!providerSignals.questionBoundaryFound) driftReasons.push("question_boundary_missing");
  if (metrics.questionCount === 0) driftReasons.push("question_structure_missing");
  if (inspection.capabilities.hasNextPage && !providerSignals.nextControlFound) {
    driftReasons.push("navigation_boundary_missing");
  }
  if (!inspection.capabilities.hasNextPage && !providerSignals.submitControlFound) {
    driftReasons.push("submit_boundary_missing");
  }
  if (metrics.labelCoveragePercent < 100) driftReasons.push("label_coverage_incomplete");
  if (metrics.recognizedTypeCoveragePercent < 100) driftReasons.push("control_type_coverage_incomplete");
  if (metrics.providerIdCoveragePercent < 100) driftReasons.push("provider_id_coverage_incomplete");
  if (metrics.usableLocatorCoveragePercent < 100) driftReasons.push("locator_coverage_incomplete");

  const inspectionBlockers = new Set<WebFormContractDriftReason>([
    "markup_boundary_missing",
    "question_boundary_missing",
    "question_structure_missing",
    "navigation_boundary_missing"
  ]);
  return {
    safeForInspection: !driftReasons.some((reason) => inspectionBlockers.has(reason)),
    safeForNativePreparation: driftReasons.length === 0 && !inspection.capabilities.hasNextPage,
    driftReasons
  };
}
