import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readZip } from "./docx_package.mjs";
import { extractParagraphs } from "./docx_text.mjs";
import { importSchema, summarizeImport, textToParagraphs } from "./schema_importer.mjs";

const supportedExtensions = new Map([
  [".docx", "docx"],
  [".pdf", "pdf"],
  [".txt", "text"],
  [".text", "text"],
  [".md", "text"]
]);

export function inferImportFormat(filename) {
  return supportedExtensions.get(path.extname(filename).toLowerCase()) || null;
}

export function supportedImportDescription() {
  return [...supportedExtensions.keys()].join(", ");
}

export function canUseAsDocxTemplate(importFormat) {
  return importFormat === "docx";
}

function runPdfToText(inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-layout", inputPath, "-"], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) resolve(stdout);
      else reject(new Error(stderr || `pdftotext exited with code ${code}`));
    });
  });
}

function decodePdfString(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function extractLiteralPdfText(buffer) {
  const source = buffer.toString("latin1");
  const pieces = [];

  for (const match of source.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    pieces.push(decodePdfString(match[1]));
  }

  for (const match of source.matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ/g)) {
    for (const stringMatch of match[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
      pieces.push(decodePdfString(stringMatch[1]));
    }
  }

  return pieces
    .join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfText(inputPath) {
  try {
    const text = await runPdfToText(inputPath);
    return {
      text,
      note: "PDF text extracted with pdftotext."
    };
  } catch (error) {
    const fallbackText = extractLiteralPdfText(await readFile(inputPath));
    if (!fallbackText) {
      throw new Error(
        `Could not extract PDF text. Install Poppler pdftotext or export the PDF to text/DOCX first. Last error: ${error.message}`
      );
    }
    return {
      text: fallbackText,
      note: "PDF text extracted with limited built-in literal-string fallback. Review carefully; scanned or encoded PDFs may be incomplete."
    };
  }
}

export async function importSchemaFromDocx(inputPath) {
  const templateBuffer = await readFile(inputPath);
  const documentEntry = readZip(templateBuffer).find((entry) => entry.name === "word/document.xml");
  if (!documentEntry) throw new Error("DOCX did not contain word/document.xml.");

  const schema = importSchema({
    filename: inputPath,
    format: "docx",
    paragraphs: extractParagraphs(documentEntry.data.toString("utf8"))
  });

  return {
    schema,
    format: "docx",
    notes: []
  };
}

export async function importSchemaFromPdf(inputPath) {
  const extracted = await extractPdfText(inputPath);
  const schema = importSchema({
    filename: inputPath,
    format: "pdf",
    paragraphs: textToParagraphs(extracted.text),
    notes: [extracted.note]
  });

  return {
    schema,
    format: "pdf",
    notes: [extracted.note]
  };
}

export async function importSchemaFromText(inputPath) {
  const text = await readFile(inputPath, "utf8");
  const schema = importSchema({
    filename: inputPath,
    format: "text",
    paragraphs: textToParagraphs(text)
  });

  return {
    schema,
    format: "text",
    notes: []
  };
}

export async function importSchemaFromFile(inputPath, importFormat = inferImportFormat(inputPath)) {
  if (importFormat === "docx") return importSchemaFromDocx(inputPath);
  if (importFormat === "pdf") return importSchemaFromPdf(inputPath);
  if (importFormat === "text") return importSchemaFromText(inputPath);
  throw new Error(`Unsupported import format. Supported extensions: ${supportedImportDescription()}.`);
}

export function summarizeSchemaImport(schema) {
  return summarizeImport(schema);
}
