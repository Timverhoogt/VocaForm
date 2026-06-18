import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  importSchema,
  parseArgs,
  requireArg,
  summarizeImport,
  textToParagraphs
} from "./schema_importer.mjs";

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

async function extractPdfText(inputPath) {
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

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "--input", 0);
const outputPath = requireArg(args, "--out", 1);
const extracted = await extractPdfText(inputPath);

const schema = importSchema({
  filename: inputPath,
  format: "pdf",
  paragraphs: textToParagraphs(extracted.text),
  notes: [extracted.note]
});
const summary = summarizeImport(schema);

await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Wrote draft schema: ${path.resolve(outputPath)}`);
console.log(`Imported sections: ${summary.sections}`);
console.log(`Imported fields: ${summary.fields}`);
console.log(extracted.note);

