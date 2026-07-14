import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadGoldenCompilerFixtures } from "./golden_fixtures";
import {
  buildMedicalPdfRenderingFixture,
  buildSchoolDocxRenderingFixture
} from "./rendering_fixtures";

const outputDirectory = path.resolve(process.argv[2] ?? "work/golden");
const fixtures = await loadGoldenCompilerFixtures();
const school = fixtures.find((fixture) => fixture.id === "elementary-school-docx");
if (!school) throw new Error("The school rendering fixture definition is unavailable.");

await mkdir(outputDirectory, { recursive: true });
const schoolPath = path.join(outputDirectory, "elementary-school-intake.docx");
const medicalPath = path.join(outputDirectory, "medical-intake.pdf");
await Promise.all([
  writeFile(schoolPath, buildSchoolDocxRenderingFixture(school.form)),
  writeFile(medicalPath, await buildMedicalPdfRenderingFixture())
]);

console.log(JSON.stringify({ school: schoolPath, medical: medicalPath }, null, 2));
