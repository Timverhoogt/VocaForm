import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, validateFormSchema } from "./form_state.mjs";

function getArg(name, positionalIndex, fallback = null) {
  const namedIndex = process.argv.indexOf(name);
  if (namedIndex !== -1) return process.argv[namedIndex + 1] ?? fallback;
  const positional = process.argv.slice(2).filter((item) => !item.startsWith("--"));
  return positional[positionalIndex] ?? fallback;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = getArg("--schema", 0, path.join(root, "data", "example_entreeformulier.schema.json"));
const schema = await loadJson(schemaPath);
const errors = validateFormSchema(schema);

if (errors.length) {
  console.error("Schema check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const fieldCount = schema.sections.reduce((total, section) => total + section.fields.length, 0);
console.log(`Schema OK: ${schema.form_id}`);
console.log(`Profile fields: ${schema.profile_fields.length}`);
console.log(`Interview fields: ${fieldCount}`);
