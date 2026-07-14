import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateCompilation, toFormDefinition } from "../domain/compiler";
import { getConfig } from "../server/config";
import { prepareCompilerDocument } from "../server/document_upload";
import { OpenAiFormCompiler } from "../server/form_compiler";
import { aggregateCompilerMetrics, evaluateCompilerForm, type CompilerMetrics } from "./compiler_metrics";
import { loadGoldenCompilerFixtures } from "./golden_fixtures";

const args = parseArgs(process.argv.slice(2));
const config = getConfig();
if (!config.openAiApiKey) throw new Error("Set OPENAI_API_KEY before running the live compiler evaluation.");

const requested = [
  { id: "medical-intake-pdf", filePath: requireArg(args, "medical") },
  { id: "elementary-school-docx", filePath: requireArg(args, "school") },
  { id: "activity-permission-conditional", filePath: requireArg(args, "permission") }
];
const repeats = Math.max(1, Math.min(3, Number(args.get("repeats") || "1")));
const fixtures = await loadGoldenCompilerFixtures();
const compiler = new OpenAiFormCompiler(config);
const results: Array<{
  id: string;
  run: number;
  readinessScore: number;
  inputTokens: number | null;
  outputTokens: number | null;
  metrics: CompilerMetrics;
}> = [];

for (const item of requested) {
  const fixture = fixtures.find((candidate) => candidate.id === item.id);
  if (!fixture) throw new Error(`Missing answer key for ${item.id}.`);
  const bytes = await readFile(item.filePath);
  for (let run = 1; run <= repeats; run += 1) {
    console.error(`Starting ${item.id} run ${run}/${repeats}...`);
    const document = await prepareCompilerDocument({
      fileName: path.basename(item.filePath),
      mimeType: "application/octet-stream",
      dataBase64: bytes.toString("base64")
    }, { sofficeBin: config.sofficeBin });
    const modelResult = await compiler.compile(document);
    const readiness = evaluateCompilation(modelResult.output, document.searchableText);
    const hasFields = modelResult.output.sections.some((section) => section.fields.length > 0);
    if (!hasFields) throw new Error(`${item.id} run ${run} produced no fields.`);
    const form = toFormDefinition(modelResult.output, {
      fileName: document.fileName,
      format: document.format,
      searchableText: document.searchableText
    });
    results.push({
      id: item.id,
      run,
      readinessScore: readiness.score,
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens,
      metrics: evaluateCompilerForm(form, fixture.answerKey)
    });
    console.error(`Finished ${item.id} run ${run}/${repeats}: readiness ${readiness.score}.`);
    if (!readiness.ready) {
      console.error(`${item.id} run ${run} failed readiness: ${readiness.issues.map((issue) => issue.id).join(", ")}`);
      process.exitCode = 1;
    }
  }
}

const aggregate = aggregateCompilerMetrics(results.map((result) => result.metrics));
console.log(JSON.stringify({ model: config.openAiModel, repeats, results, aggregate }, null, 2));
if (aggregate.fieldRecallPercent < 95
  || aggregate.requiredRecallPercent < 100
  || aggregate.fabricatedFieldIds.length > 0
  || aggregate.missingDependencies.length > 0) {
  process.exitCode = 1;
}

function parseArgs(values: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (key && value) parsed.set(key, value);
  }
  return parsed;
}

function requireArg(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Pass --${key} /path/to/form.`);
  return path.resolve(value);
}
