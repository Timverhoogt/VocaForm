import { aggregateCompilerMetrics, evaluateCompilerForm } from "./compiler_metrics";
import { loadGoldenCompilerFixtures } from "./golden_fixtures";

const fixtures = await loadGoldenCompilerFixtures();
const results = fixtures.map((fixture) => ({
  id: fixture.id,
  metrics: evaluateCompilerForm(fixture.form, fixture.answerKey)
}));
const aggregate = aggregateCompilerMetrics(results.map((result) => result.metrics));

console.log(JSON.stringify({ fixtures: results, aggregate }, null, 2));

if (aggregate.fieldRecallPercent < 95
  || aggregate.requiredRecallPercent < 100
  || aggregate.fabricatedFieldIds.length > 0
  || aggregate.missingDependencies.length > 0) {
  process.exitCode = 1;
}
