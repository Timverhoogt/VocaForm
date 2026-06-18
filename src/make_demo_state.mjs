import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialState, getAllInterviewFields, loadJson, recordAnswer } from "./form_state.mjs";

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = getArg("--schema") || path.join(root, "data", "mees_entreeformulier.schema.json");
const profilePath = getArg("--profile") || path.join(root, "data", "family_profile.example.json");
const outPath = getArg("--out");

const schema = await loadJson(schemaPath);
const profile = await loadJson(profilePath);
const state = createInitialState(schema, profile);

state.metadata = {
  demo: true,
  warning: "This file contains generated demo answers only. Do not submit it as a real form."
};

for (const field of getAllInterviewFields(schema)) {
  recordAnswer(state, {
    field_id: field.id,
    status: "answered",
    raw_answer: `[DEMO] Voorbeeldantwoord voor: ${field.label}.`,
    normalized_answer: `[DEMO] ${field.label}: voorbeeldtekst om de DOCX-renderer te testen. Vervang dit door een echt antwoord uit het interview.`,
    confidence: 1,
    follow_up_question: null
  });
}

const json = `${JSON.stringify(state, null, 2)}\n`;
if (outPath) {
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, json, "utf8");
  console.log(`Wrote demo state: ${path.resolve(outPath)}`);
} else {
  process.stdout.write(json);
}

