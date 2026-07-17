import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config";
import { buildMedicalPdfRenderingFixture } from "../evals/rendering_fixtures";
import { prepareCompilerDocument } from "./document_upload";
import { buildCompilerRequest } from "./form_compiler_request";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 5177,
  publicDemo: false,
  storageMode: "local",
  openAiApiKey: "test-key",
  openAiModel: "gpt-5.6-sol",
  openAiReasoningEffort: "high",
  openAiVerificationModel: "gpt-5.6-sol",
  openAiVerificationReasoningMode: "standard",
  openAiRealtimeModel: "gpt-realtime-2.1",
  openAiRealtimeVoice: "marin",
  openAiRealtimeSpeed: 0.95,
  openAiRealtimeReasoningEffort: "low",
  openAiRealtimeTranscriptionModel: "gpt-4o-mini-transcribe",
  openAiRealtimeLanguage: "",
  openAiSafetyIdentifier: "synthetic-test",
  webFormNativePreparation: true,
  webFormInspectionTimeoutMs: 30_000,
  webFormActionTimeoutMs: 10_000,
  webFormSessionTtlMs: 900_000,
  webFormMaxConcurrentSessions: 4,
  webFormMaxRequests: 300,
  workDir: "work",
  sofficeBin: "soffice"
};

describe("OpenAI form compiler request", () => {
  it("uses the explicit Sol model, strict structured output, and no response storage", async () => {
    const document = await prepareCompilerDocument({
      fileName: "simple-form.txt",
      mimeType: "text/plain",
      dataBase64: Buffer.from("Name (required): ______").toString("base64")
    }, config);
    const request = buildCompilerRequest(document, config);

    expect(request.model).toBe("gpt-5.6-sol");
    expect(request.store).toBe(false);
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.safety_identifier).toBe("synthetic-test");
    const text = request.text as { format: { type: string; strict: boolean; schema: unknown } };
    expect(text.format).toMatchObject({ type: "json_schema", strict: true });
    expectStrictObjectSchemas(text.format.schema);
  });

  it("sends PDF pages at high detail", async () => {
    const document = await prepareCompilerDocument({
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64")
    }, config);

    expect(document.visualStrategy).toBe("direct_pdf");
    expect(document.content[0]).toEqual(expect.objectContaining({
      type: "input_file",
      detail: "high",
      filename: "scan.pdf"
    }));
  });

  it("retains original bytes privately and supplies verified AcroForm field names", async () => {
    const source = await buildMedicalPdfRenderingFixture();
    const document = await prepareCompilerDocument({
      fileName: "medical-intake.pdf",
      mimeType: "application/pdf",
      dataBase64: source.toString("base64")
    }, config);

    expect(document.originalBytes.equals(source)).toBe(true);
    expect(document.originalBytes).not.toBe(source);
    expect(document.content).toContainEqual(expect.objectContaining({
      type: "input_text",
      text: expect.stringContaining("patient_name\tPDFTextField") as string
    }));
  });

  it("rejects file types that are outside the compiler contract", async () => {
    await expect(prepareCompilerDocument({
      fileName: "archive.zip",
      mimeType: "application/zip",
      dataBase64: Buffer.from("PK invalid").toString("base64")
    }, config)).rejects.toThrow("PDF, DOCX, TXT, or Markdown");
  });
});

function expectStrictObjectSchemas(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectStrictObjectSchemas);
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "object" && isRecord(value.properties)) {
    expect(value.additionalProperties).toBe(false);
    expect(new Set(value.required as string[])).toEqual(new Set(Object.keys(value.properties)));
  }
  Object.values(value).forEach(expectStrictObjectSchemas);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
