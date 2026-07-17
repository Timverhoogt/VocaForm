import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  redactOperationalDiagnostic,
  WebFormOperationalTelemetry,
  type WebFormTelemetryRecord
} from "./web_form_telemetry";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("privacy-safe web-form telemetry", () => {
  it("retains aggregate coverage and fallback metrics in a private file", () => {
    const directory = temporaryDirectory();
    const telemetry = new WebFormOperationalTelemetry(directory);

    expect(telemetry.record({
      event: "inspection",
      provider: "google_forms",
      outcome: "fallback",
      durationMs: 842,
      questionCount: 4,
      unsupportedControlCount: 1,
      labelCoveragePercent: 100,
      recognizedTypeCoveragePercent: 100,
      providerIdCoveragePercent: 75,
      usableLocatorCoveragePercent: 75,
      fallbackReason: "unstable_locator",
      failureCode: "contract_drift"
    }, new Date("2026-07-17T14:00:00.000Z"))).toBe(true);

    const record = JSON.parse(readFileSync(telemetry.filePath, "utf8")) as WebFormTelemetryRecord;
    expect(record).toMatchObject({
      schemaVersion: 1,
      provider: "google_forms",
      questionCount: 4,
      fallbackReason: "unstable_locator"
    });
    expect(statSync(telemetry.filePath).mode & 0o777).toBe(0o600);
  });

  it("rejects identifiers, URLs, screenshots, and answer values", () => {
    const telemetry = new WebFormOperationalTelemetry(temporaryDirectory());
    expect(telemetry.record({
      event: "preparation",
      provider: "microsoft_forms",
      outcome: "error",
      answer: "Sensitive answer",
      responderUrl: "https://forms.office.com/r/private",
      screenshot: "base64"
    })).toBe(false);
  });

  it("redacts common responder and tenant identifiers from diagnostics", () => {
    const redacted = redactOperationalDiagnostic(
      "page.goto https://forms.office.com/r/private?tenant_id=secret for sam@example.com entry.123 "
      + "QuestionId_person-42 provider_id:ms-private 123e4567-e89b-42d3-a456-426614174000"
    );

    expect(redacted).not.toContain("forms.office.com");
    expect(redacted).not.toContain("sam@example.com");
    expect(redacted).not.toContain("entry.123");
    expect(redacted).not.toContain("person-42");
    expect(redacted).not.toContain("ms-private");
    expect(redacted).not.toContain("123e4567");
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "vocaform-webform-telemetry-"));
  temporaryDirectories.push(directory);
  return directory;
}
