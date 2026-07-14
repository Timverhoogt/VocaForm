import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceDocument } from "../adapters/document_renderer";
import type { FormDefinition } from "../domain/schemas";
import type { FixtureSummary } from "../shared/api";
import { fromLegacyForm } from "../adapters/legacy_form_adapter";
import {
  buildMedicalPdfRenderingFixture,
  buildSchoolDocxRenderingFixture,
  withMedicalPdfTargets
} from "../evals/rendering_fixtures";

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
  },
  {
    id: "medical-intake",
    title: "New patient medical intake",
    description: "A synthetic fillable PDF that demonstrates field-level export without retaining medical answers in memory.",
    format: "pdf",
    path: null
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
  if (fixture.id === "medical-intake") {
    const { loadGoldenCompilerFixtures } = await import("../evals/golden_fixtures");
    const golden = (await loadGoldenCompilerFixtures())
      .find((candidate) => candidate.id === "medical-intake-pdf");
    if (!golden) throw new Error("The medical intake fixture is unavailable.");
    return withMedicalPdfTargets(golden.form);
  }
  if (!fixture.path) throw new Error(`Fixture ${fixtureId} has no source file.`);
  const source = JSON.parse(await readFile(fixture.path, "utf8")) as unknown;
  return fromLegacyForm(source);
}

export async function loadFixtureSource(fixtureId: string): Promise<SourceDocument | null> {
  if (fixtureId === "activity-permission") {
    return {
      fileName: "activity-permission.txt",
      format: "text",
      bytes: await readFile(path.resolve("data/golden/activity-permission.txt"))
    };
  }
  if (fixtureId === "school-intake") {
    const form = await loadFixture(fixtureId);
    return {
      fileName: form.source.fileName,
      format: "docx",
      bytes: buildSchoolDocxRenderingFixture(form)
    };
  }
  if (fixtureId === "medical-intake") {
    return {
      fileName: "medical-intake.pdf",
      format: "pdf",
      bytes: await buildMedicalPdfRenderingFixture()
    };
  }
  return null;
}
