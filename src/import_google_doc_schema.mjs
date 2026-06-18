import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getArg,
  importSchema,
  parseArgs,
  requireArg,
  summarizeImport,
  textToParagraphs
} from "./schema_importer.mjs";

function extractDocId(value) {
  if (/^[a-zA-Z0-9_-]{20,}$/.test(value)) return value;
  const match = String(value).match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  throw new Error("Could not extract Google Doc id. Pass --doc-id or a /document/d/<id>/ URL.");
}

const args = parseArgs(process.argv.slice(2));
const source = getArg(args, "--doc-id", 0) || getArg(args, "--url", 0);
if (!source) {
  requireArg(args, "--doc-id", 0);
}
const outputPath = requireArg(args, "--out", 1);
const docId = extractDocId(source);
const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
const response = await fetch(exportUrl);

if (!response.ok) {
  throw new Error(
    `Google Docs export failed (${response.status}). Public/export-accessible docs work directly; private docs need manual export to DOCX/text or authenticated download.`
  );
}

const text = await response.text();
if (!text.trim()) throw new Error("Google Docs export returned no text.");

const schema = importSchema({
  filename: `${docId}.google-doc.txt`,
  format: "google-doc-text",
  paragraphs: textToParagraphs(text),
  notes: [
    "Imported from Google Docs plain-text export.",
    "For private documents, export manually to DOCX/text or add an authenticated connector."
  ]
});
const summary = summarizeImport(schema);

await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Wrote draft schema: ${path.resolve(outputPath)}`);
console.log(`Imported sections: ${summary.sections}`);
console.log(`Imported fields: ${summary.fields}`);

