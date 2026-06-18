import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { importSchemaFromPdf, summarizeSchemaImport } from "./form_importers.mjs";
import { parseArgs, requireArg } from "./schema_importer.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "--input", 0);
const outputPath = requireArg(args, "--out", 1);
const { schema, notes } = await importSchemaFromPdf(inputPath);
const summary = summarizeSchemaImport(schema);

await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Wrote draft schema: ${path.resolve(outputPath)}`);
console.log(`Imported sections: ${summary.sections}`);
console.log(`Imported fields: ${summary.fields}`);
for (const note of notes) console.log(note);
