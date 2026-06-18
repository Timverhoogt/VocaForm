import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.mjs";
import { requestStructuredJson } from "./openrouter.mjs";
import {
  createInitialState,
  getAllInterviewFields,
  listOpenFields,
  loadJson,
  summarizeState
} from "./form_state.mjs";
import {
  answerRecordJsonSchema,
  buildAnswerNormalizerSystemPrompt,
  buildAnswerNormalizerUserPrompt,
  buildQuestionForField
} from "./prompts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = await loadJson(path.join(root, "data", "mees_entreeformulier.schema.json"));
const profile = await loadJson(path.join(root, "data", "family_profile.example.json"));
const state = createInitialState(schema, profile);
const summary = summarizeState(schema, state);

console.log("Initial state");
console.log(JSON.stringify(summary, null, 2));
console.log("");

const nextFields = listOpenFields(schema, state).slice(0, 5);
console.log("First interview questions");
for (const field of nextFields) {
  console.log(`- [${field.section_title}] ${buildQuestionForField(field)}`);
}

const liveIndex = process.argv.indexOf("--live");
if (liveIndex === -1) {
  console.log("");
  console.log("Run with --live \"answer text\" to test OpenRouter normalization for the first open field.");
  process.exit(0);
}

const transcript = process.argv.slice(liveIndex + 1).join(" ").trim();
if (!transcript) {
  throw new Error("Pass answer text after --live.");
}

const field = getAllInterviewFields(schema).find((item) => item.id === nextFields[0].id);
const config = getConfig();
const result = await requestStructuredJson({
  config,
  system: buildAnswerNormalizerSystemPrompt(),
  user: buildAnswerNormalizerUserPrompt({ field, transcript }),
  jsonSchema: answerRecordJsonSchema
});

console.log("");
console.log("Normalized answer record");
console.log(JSON.stringify(result.data, null, 2));

