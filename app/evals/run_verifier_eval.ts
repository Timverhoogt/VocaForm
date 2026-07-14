import { verifySession } from "../domain/session";
import { buildFinalVerification } from "../domain/verification";
import { loadDeterministicVerificationFixtures } from "./verification_fixtures";

const fixtures = await loadDeterministicVerificationFixtures();
const results = fixtures.map((fixture) => {
  const verification = verifySession(fixture.session);
  const caught = verification.issues.some((issue) =>
    issue.source === "deterministic"
      && issue.fieldId === fixture.expected.fieldId
      && issue.kind === fixture.expected.kind
  );
  const finalVerification = buildFinalVerification(fixture.session, {
    modelAvailable: true,
    semanticRun: {
      sessionId: fixture.session.id,
      sessionVersion: fixture.session.version,
      status: "completed",
      issues: [],
      model: "synthetic-eval",
      mode: "standard",
      responseId: "synthetic",
      checkedAt: "2026-07-14T13:00:00.000Z",
      inputTokens: 0,
      outputTokens: 0
    }
  });
  return {
    id: fixture.id,
    expected: fixture.expected,
    caught,
    finalExportBlocked: !finalVerification.readyForFinalExport
  };
});
const caughtCount = results.filter((result) => result.caught).length;
const gatedCount = results.filter((result) => result.finalExportBlocked).length;

console.log(JSON.stringify({
  fixtures: results,
  aggregate: {
    fixtureCount: results.length,
    caughtCount,
    recallPercent: Math.round((caughtCount / results.length) * 100),
    finalExportGatedPercent: Math.round((gatedCount / results.length) * 100)
  }
}, null, 2));

if (caughtCount !== results.length || gatedCount !== results.length) process.exitCode = 1;
