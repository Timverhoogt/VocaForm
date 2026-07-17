import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { readZip } from "../../src/docx_package.mjs";
import { extractParagraphs } from "../../src/docx_text.mjs";
import { extractPdfText } from "../../src/form_importers.mjs";
import type { DocumentFormDefinition } from "../domain/schemas";

const execFileAsync = promisify(execFile);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const documentUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().max(120),
  dataBase64: z.string().min(1).max(Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 8)
});

export type DocumentUpload = z.infer<typeof documentUploadSchema>;
export type VisualStrategy = "direct_pdf" | "docx_visual_pdf" | "plain_text";
export type CompilerInputContent =
  | { type: "input_text"; text: string }
  | {
      type: "input_file";
      filename: string;
      file_data: string;
      detail?: "high";
    };

export interface PreparedCompilerDocument {
  fileName: string;
  format: DocumentFormDefinition["source"]["format"];
  byteLength: number;
  originalBytes: Buffer;
  searchableText: string | null;
  content: CompilerInputContent[];
  visualStrategy: VisualStrategy;
  originalRetained: boolean;
}

export async function prepareCompilerDocument(
  input: unknown,
  options: { sofficeBin: string }
): Promise<PreparedCompilerDocument> {
  const upload = documentUploadSchema.parse(input);
  const bytes = decodeBase64(upload.dataBase64);
  if (bytes.length === 0) throw new Error("The uploaded file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("The uploaded file exceeds the 10 MB limit.");

  const fileName = safeUploadName(upload.fileName);
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pdf") return preparePdf(fileName, bytes);
  if (extension === ".docx") return prepareDocx(fileName, bytes, options.sofficeBin);
  if (extension === ".txt" || extension === ".md" || extension === ".text") {
    return prepareText(fileName, bytes);
  }
  throw new Error("Use a PDF, DOCX, TXT, or Markdown file.");
}

async function preparePdf(fileName: string, bytes: Buffer): Promise<PreparedCompilerDocument> {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("The file extension says PDF, but the file is not a valid PDF.");
  }
  const searchableText = await withTemporaryFile(fileName, bytes, async (filePath) => {
    try {
      const result = await extractPdfText(filePath) as { text: string };
      return result.text.trim() || null;
    } catch {
      return null;
    }
  });
  const pdfFields = await inspectPdfFields(bytes);

  return {
    fileName,
    format: "pdf",
    byteLength: bytes.length,
    originalBytes: Buffer.from(bytes),
    searchableText,
    content: [
      {
        type: "input_file",
        filename: fileName,
        file_data: dataUrl("application/pdf", bytes),
        detail: "high"
      },
      ...(pdfFields.length > 0 ? [{
        type: "input_text" as const,
        text: [
          "BEGIN VERIFIED ACROFORM FIELD INVENTORY",
          ...pdfFields.map((field) => `${field.name}\t${field.type}`),
          "END VERIFIED ACROFORM FIELD INVENTORY",
          "Use a pdf_field render target only when its locator exactly matches a name in this inventory."
        ].join("\n")
      }] : [])
    ],
    visualStrategy: "direct_pdf",
    originalRetained: true
  };
}

async function prepareDocx(
  fileName: string,
  bytes: Buffer,
  sofficeBin: string
): Promise<PreparedCompilerDocument> {
  if (!bytes.subarray(0, 2).equals(Buffer.from("PK"))) {
    throw new Error("The file extension says DOCX, but the file is not a valid DOCX package.");
  }
  const documentEntry = readZip(bytes).find((entry: { name: string }) => entry.name === "word/document.xml");
  if (!documentEntry) throw new Error("The DOCX does not contain a Word document body.");
  const paragraphs = extractParagraphs(documentEntry.data.toString("utf8")) as Array<{ text: string }>;
  const searchableText = paragraphs.map((paragraph) => paragraph.text).filter(Boolean).join("\n").trim() || null;

  const visualPdf = await convertDocxToPdf(fileName, bytes, sofficeBin);
  return {
    fileName,
    format: "docx",
    byteLength: bytes.length,
    originalBytes: Buffer.from(bytes),
    searchableText,
    content: [
      {
        type: "input_file",
        filename: fileName,
        file_data: dataUrl("application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes)
      },
      {
        type: "input_file",
        filename: `${path.basename(fileName, path.extname(fileName))}-visual.pdf`,
        file_data: dataUrl("application/pdf", visualPdf),
        detail: "high"
      }
    ],
    visualStrategy: "docx_visual_pdf",
    originalRetained: true
  };
}

function prepareText(fileName: string, bytes: Buffer): PreparedCompilerDocument {
  if (bytes.includes(0)) throw new Error("The text file contains binary data.");
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("The uploaded text file is empty.");
  return {
    fileName,
    format: "text",
    byteLength: bytes.length,
    originalBytes: Buffer.from(bytes),
    searchableText: text,
    content: [{
      type: "input_text",
      text: `BEGIN UPLOADED FORM\n${text}\nEND UPLOADED FORM`
    }],
    visualStrategy: "plain_text",
    originalRetained: true
  };
}

async function inspectPdfFields(bytes: Buffer): Promise<Array<{ name: string; type: string }>> {
  try {
    const pdf = await PDFDocument.load(Uint8Array.from(bytes), {
      ignoreEncryption: false,
      updateMetadata: false
    });
    return pdf.getForm().getFields().map((field) => ({
      name: field.getName(),
      type: field.constructor.name
    }));
  } catch {
    return [];
  }
}

async function convertDocxToPdf(fileName: string, bytes: Buffer, sofficeBin: string): Promise<Buffer> {
  const directory = await mkdtemp(path.join(tmpdir(), "vocaform-docx-"));
  const inputPath = path.join(directory, fileName);
  const outputPath = path.join(directory, `${path.basename(fileName, path.extname(fileName))}.pdf`);
  const profileUrl = pathToFileURL(path.join(directory, "libreoffice-profile")).href;
  try {
    await writeFile(inputPath, bytes);
    await execFileAsync(sofficeBin, [
      `-env:UserInstallation=${profileUrl}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      directory,
      inputPath
    ], { timeout: 45_000, maxBuffer: 1024 * 1024 });
    const pdf = await readFile(outputPath);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Converter returned an invalid PDF.");
    return pdf;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown conversion error";
    throw new Error(
      `DOCX visual conversion failed. Install LibreOffice or set SOFFICE_BIN. ${detail}`,
      { cause: error }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withTemporaryFile<T>(
  fileName: string,
  bytes: Buffer,
  operation: (filePath: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "vocaform-upload-"));
  const filePath = path.join(directory, fileName);
  try {
    await writeFile(filePath, bytes);
    return await operation(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function decodeBase64(value: string): Buffer {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("The uploaded file data is not valid base64.");
  }
  return Buffer.from(value, "base64");
}

function safeUploadName(value: string): string {
  const base = path.basename(value.trim()).replace(/[^\p{L}\p{N}._ -]+/gu, "-");
  return base.slice(0, 180) || "uploaded-form";
}

function dataUrl(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
