import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  importSchema,
  parseArgs,
  requireArg,
  summarizeImport,
  textToParagraphs
} from "./schema_importer.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "--input", 0);
const outputPath = requireArg(args, "--out", 1);
const text = await readFile(inputPath, "utf8");

const schema = importSchema({
  filename: inputPath,
  format: "text",
  paragraphs: textToParagraphs(text)
});
const summary = summarizeImport(schema);

await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Wrote draft schema: ${path.resolve(outputPath)}`);
console.log(`Imported sections: ${summary.sections}`);
console.log(`Imported fields: ${summary.fields}`);

