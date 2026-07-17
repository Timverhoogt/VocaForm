import { inspectRemoteWebForm } from "../adapters/web_form_browser";
import { assessWebFormProviderContract } from "../adapters/web_form_contract";
import type { WebFormProvider } from "../adapters/web_form_inspection";
import { redactOperationalDiagnostic } from "../server/web_form_telemetry";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const providerArgument = args.find((argument) => argument.startsWith("--provider="))?.split("=")[1];

  if (args.includes("--help")) {
    console.log(
      "Usage: npm run check:webforms:live or npm run check:webform:live:google|microsoft\n"
      + "Set VOCAFORM_LIVE_GOOGLE_FORM_URL and VOCAFORM_LIVE_MICROSOFT_FORM_URL to disposable, public, single-page contract forms."
    );
  } else if (["0", "false", "off", "disabled"].includes(
    process.env.VOCAFORM_WEBFORM_LIVE_CHECKS?.trim().toLowerCase() ?? ""
  )) {
    console.log(JSON.stringify({ enabled: false, passed: true }));
  } else {
    const providers = requestedProviders(providerArgument);
    const results = [];
    for (const provider of providers) {
      const url = liveUrl(provider);
      if (!url) {
        throw new Error(
          `The ${providerLabel(provider)} live contract URL is not configured. `
          + "Use a disposable public form or explicitly disable live checks."
        );
      }
      const startedAt = performance.now();
      const inspection = await inspectRemoteWebForm(url, {
        timeoutMs: 30_000,
        actionTimeoutMs: 10_000,
        maxRequests: 300,
        maxConcurrentInspections: 1
      });
      const assessment = assessWebFormProviderContract(inspection);
      if (!assessment.safeForNativePreparation) {
        throw new Error(
          `${providerLabel(provider)} live contract drift: ${assessment.driftReasons.join(", ") || "unknown"}.`
        );
      }
      results.push({
        provider,
        passed: true,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        questionCount: inspection.metrics.questionCount,
        labelCoveragePercent: inspection.metrics.labelCoveragePercent,
        recognizedTypeCoveragePercent: inspection.metrics.recognizedTypeCoveragePercent,
        providerIdCoveragePercent: inspection.metrics.providerIdCoveragePercent,
        usableLocatorCoveragePercent: inspection.metrics.usableLocatorCoveragePercent,
        submitBoundaryFound: inspection.providerSignals.submitControlFound
      });
    }
    console.log(JSON.stringify({ enabled: true, passed: true, providers: results }, null, 2));
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "The live web-form contract check failed.";
  console.error(redactOperationalDiagnostic(message));
  process.exitCode = 1;
});

function requestedProviders(value: string | undefined): WebFormProvider[] {
  if (!value) return ["google_forms", "microsoft_forms"];
  if (value === "google_forms" || value === "microsoft_forms") return [value];
  throw new Error("The live contract provider must be google_forms or microsoft_forms.");
}

function liveUrl(provider: WebFormProvider): string {
  return provider === "google_forms"
    ? process.env.VOCAFORM_LIVE_GOOGLE_FORM_URL?.trim() ?? ""
    : process.env.VOCAFORM_LIVE_MICROSOFT_FORM_URL?.trim() ?? "";
}

function providerLabel(provider: WebFormProvider): string {
  return provider === "google_forms" ? "Google Forms" : "Microsoft Forms";
}
