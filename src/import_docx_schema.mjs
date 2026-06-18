import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readZip } from "./docx_package.mjs";
import { extractParagraphs } from "./docx_text.mjs";
import { importSchema, parseArgs, requireArg, summarizeImport } from "./schema_importer.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "--input", 0);
const outputPath = requireArg(args, "--out", 1);
const templateBuffer = await readFile(inputPath);
const documentEntry = readZip(templateBuffer).find((entry) => entry.name === "word/document.xml");
if (!documentEntry) throw new Error("DOCX did not contain word/document.xml.");

const schema = importSchema({
  filename: inputPath,
  format: "docx",
  paragraphs: extractParagraphs(documentEntry.data.toString("utf8"))
});
const summary = summarizeImport(schema);

await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Wrote draft schema: ${path.resolve(outputPath)}`);
console.log(`Imported sections: ${summary.sections}`);
console.log(`Imported fields: ${summary.fields}`);
