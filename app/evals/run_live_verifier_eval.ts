import { createSemanticIssues } from "../domain/verification";
import { getConfig } from "../server/config";
import { OpenAiFinalVerifier } from "../server/final_verifier";
import { loadSemanticVerificationFixtures } from "./verification_fixtures";

type Mode = "standard" | "pro";

const config = getConfig();
if (!config.openAiApiKey) throw new Error("Set OPENAI_API_KEY before running the live verifier evaluation.");
const repeats = parseRepeats(process.argv.slice(2));
const fixtures = await loadSemanticVerificationFixtures();
const verifier = new OpenAiFinalVerifier(config);
const results: LiveVerifierResult[] = [];

for (const mode of ["standard", "pro"] as const) {
  for (const fixture of fixtures) {
    for (let run = 1; run <= repeats; run += 1) {
      console.error(`Starting ${mode} ${fixture.id} run ${run}/${repeats}...`);
      const before = JSON.stringify(fixture.session);
      const startedAt = performance.now();
      try {
        const response = await verifier.verify(fixture.session, mode);
        const issues = createSemanticIssues(fixture.session, response.output);
        const matching = issues.filter((issue) => issue.kind === fixture.expectedKind
          && [issue.fieldId, ...issue.relatedFieldIds].some((fieldId) =>
            Boolean(fieldId && fixture.expectedFieldIds.includes(fieldId))));
        results.push({
          mode,
          fixtureId: fixture.id,
          run,
          expectedKind: fixture.expectedKind,
          detected: matching.length > 0,
          findingKinds: issues.map((issue) => issue.kind),
          extraFindingCount: Math.max(0, issues.length - matching.length),
          sessionUnchanged: JSON.stringify(fixture.session) === before,
          responseId: response.responseId,
          latencyMs: Math.round(performance.now() - startedAt),
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          error: null
        });
      } catch (error) {
        results.push({
          mode,
          fixtureId: fixture.id,
          run,
          expectedKind: fixture.expectedKind,
          detected: false,
          findingKinds: [],
          extraFindingCount: 0,
          sessionUnchanged: JSON.stringify(fixture.session) === before,
          responseId: null,
          latencyMs: Math.round(performance.now() - startedAt),
          inputTokens: null,
          outputTokens: null,
          error: error instanceof Error ? error.message : "Unknown verifier error."
        });
      }
      console.error(`Finished ${mode} ${fixture.id} run ${run}/${repeats}.`);
    }
  }
}

const standard = summarize("standard", results);
const pro = summarize("pro", results);
const recallImprovement = pro.recallPercent - standard.recallPercent;
const materiallyImproves = recallImprovement >= 20
  && pro.recallPercent > standard.recallPercent
  && pro.extraFindingCount <= standard.extraFindingCount;
const recommendedMode: Mode = materiallyImproves ? "pro" : "standard";
const selected = recommendedMode === "pro" ? pro : standard;

console.log(JSON.stringify({
  model: config.openAiVerificationModel,
  effort: config.openAiReasoningEffort,
  repeats,
  cases: fixtures.map((fixture) => ({
    id: fixture.id,
    expectedKind: fixture.expectedKind,
    expectedFieldIds: fixture.expectedFieldIds
  })),
  results,
  comparison: {
    standard,
    pro,
    recallImprovement,
    materialThresholdPoints: 20,
    materiallyImproves,
    recommendedMode,
    configuredMode: config.openAiVerificationReasoningMode
  }
}, null, 2));

if (selected.recallPercent < 100
  || selected.errorCount > 0
  || results.some((result) => !result.sessionUnchanged)) {
  process.exitCode = 1;
}

interface LiveVerifierResult {
  mode: Mode;
  fixtureId: string;
  run: number;
  expectedKind: string;
  detected: boolean;
  findingKinds: string[];
  extraFindingCount: number;
  sessionUnchanged: boolean;
  responseId: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
}

function summarize(mode: Mode, allResults: LiveVerifierResult[]) {
  const modeResults = allResults.filter((result) => result.mode === mode);
  const detectedCount = modeResults.filter((result) => result.detected).length;
  return {
    runCount: modeResults.length,
    detectedCount,
    recallPercent: Math.round((detectedCount / modeResults.length) * 100),
    extraFindingCount: modeResults.reduce((total, result) => total + result.extraFindingCount, 0),
    errorCount: modeResults.filter((result) => result.error).length,
    averageLatencyMs: Math.round(
      modeResults.reduce((total, result) => total + result.latencyMs, 0) / modeResults.length
    ),
    inputTokens: sumTokens(modeResults.map((result) => result.inputTokens)),
    outputTokens: sumTokens(modeResults.map((result) => result.outputTokens))
  };
}

function sumTokens(values: Array<number | null>): number | null {
  return values.every((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function parseRepeats(args: string[]): number {
  const index = args.indexOf("--repeats");
  const parsed = index >= 0 ? Number(args[index + 1]) : 1;
  return Number.isInteger(parsed) ? Math.max(1, Math.min(3, parsed)) : 1;
}
