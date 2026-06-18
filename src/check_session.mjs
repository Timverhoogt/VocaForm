import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, reviewSession } from "./form_state.mjs";

function parseArgs(argv) {
  const named = new Map();
  const flags = new Set();
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        named.set(item, argv[index + 1]);
        index += 1;
      } else {
        flags.add(item);
      }
    } else {
      positional.push(item);
    }
  }

  return { named, flags, positional };
}

function getArg(args, name, positionalIndex, fallback = null) {
  return args.named.get(name) || args.positional[positionalIndex] || fallback;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const schemaPath = getArg(args, "--schema", 0, path.join(root, "data", "example_entreeformulier.schema.json"));
const statePath = getArg(args, "--state", 1, path.join(root, "work", "session_state.json"));
const requireFinal = args.flags.has("--require-final");

const [schema, state] = await Promise.all([
  loadJson(schemaPath),
  loadJson(statePath)
]);
const review = reviewSession(schema, state);

console.log(JSON.stringify(review, null, 2));
if (requireFinal && !review.ready_for_final_export) {
  process.exit(1);
}

