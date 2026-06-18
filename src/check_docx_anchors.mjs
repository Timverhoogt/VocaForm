import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readZip } from "./docx_package.mjs";
import { findAnchorMatches } from "./docx_text.mjs";
import { getAllInterviewFields, loadJson } from "./form_state.mjs";

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function requireArg(name) {
  const value = getArg(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const activeFormConfigPath = path.join(root, "work", "active_form.json");

async function loadActiveFormFallback() {
  if (!existsSync(activeFormConfigPath)) return null;
  return loadJson(activeFormConfigPath);
}

const activeForm = await loadActiveFormFallback();
const templatePath = getArg("--template")
  || process.env.FORM_TEMPLATE_PATH
  || activeForm?.template_path;
const schemaPath = getArg("--schema")
  || process.env.FORM_SCHEMA_PATH
  || activeForm?.schema_path
  || path.join(root, "data", "mees_entreeformulier.schema.json");

if (!templatePath || path.extname(templatePath).toLowerCase() !== ".docx" || !existsSync(templatePath)) {
  console.log("Anchor check skipped: no active DOCX template is configured.");
  process.exit(0);
}

if (!schemaPath) requireArg("--schema");

const [templateBuffer, schema] = await Promise.all([
  readFile(templatePath),
  loadJson(schemaPath)
]);

const documentEntry = readZip(templateBuffer).find((entry) => entry.name === "word/document.xml");
if (!documentEntry) throw new Error("DOCX did not contain word/document.xml.");

const anchors = getAllInterviewFields(schema).map((field) => ({
  id: field.id,
  label: field.label,
  text: field.render_anchor || field.label
}));

const results = findAnchorMatches(documentEntry.data.toString("utf8"), anchors);
const unmatched = results.filter((result) => result.matches.length === 0);
const ambiguous = results.filter((result) => result.matches.length > 1);

console.log(`Anchor coverage: ${results.length - unmatched.length}/${results.length} matched`);
if (ambiguous.length) {
  console.log(`Ambiguous anchors: ${ambiguous.length}`);
  for (const result of ambiguous) {
    console.log(`- ${result.id}: ${result.matches.length} matches for "${result.text}"`);
  }
}
if (unmatched.length) {
  console.error(`Unmatched anchors: ${unmatched.length}`);
  for (const result of unmatched) {
    console.error(`- ${result.id}: ${result.text}`);
  }
  process.exit(1);
}
