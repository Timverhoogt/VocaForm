import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FormDefinition } from "../domain/schemas";
import type { FixtureSummary } from "../shared/api";
import { fromLegacyForm } from "../adapters/legacy_form_adapter";

interface FixtureEntry extends FixtureSummary {
  path: string | null;
}

const fixtures: FixtureEntry[] = [
  {
    id: "activity-permission",
    title: "Community Garden Day permission form",
    description: "A reviewed activity form with reusable guardian contact details and a conditional travel question.",
    format: "text",
    path: null
  },
  {
    id: "school-intake",
    title: "Elementary school intake",
    description: "A reviewed Dutch school form with 37 questions across everyday development topics.",
    format: "docx",
    path: path.resolve("data/example_entreeformulier.schema.json")
  }
];

export function listFixtures(): FixtureSummary[] {
  return fixtures.map((fixture) => ({
    id: fixture.id,
    title: fixture.title,
    description: fixture.description,
    format: fixture.format
  }));
}

export async function loadFixture(fixtureId: string): Promise<FormDefinition> {
  const fixture = fixtures.find((candidate) => candidate.id === fixtureId);
  if (!fixture) throw new Error(`Unknown fixture: ${fixtureId}`);
  if (fixture.id === "activity-permission") {
    const { loadGoldenCompilerFixtures } = await import("../evals/golden_fixtures");
    const golden = (await loadGoldenCompilerFixtures())
      .find((candidate) => candidate.id === "activity-permission-conditional");
    if (!golden) throw new Error("The activity permission fixture is unavailable.");
    return golden.form;
  }
  if (!fixture.path) throw new Error(`Fixture ${fixtureId} has no source file.`);
  const source = JSON.parse(await readFile(fixture.path, "utf8")) as unknown;
  return fromLegacyForm(source);
}
