import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderVerifiedDocument, type RenderedDocument } from "../adapters/document_renderer";
import type { FormDefinition, FormSession } from "../domain/schemas";
import { createFormSession, listFields, saveTextAnswer } from "../domain/session";
import { loadGoldenCompilerFixtures } from "./golden_fixtures";
import {
  buildMedicalPdfRenderingFixture,
  buildSchoolDocxRenderingFixture,
  withMedicalPdfTargets
} from "./rendering_fixtures";

const fixtures = await loadGoldenCompilerFixtures();
const schoolForm = requireForm("elementary-school-docx");
const medicalForm = withMedicalPdfTargets(requireForm("medical-intake-pdf"));
const schoolSource = buildSchoolDocxRenderingFixture(schoolForm);
const medicalSource = await buildMedicalPdfRenderingFixture();
const blankPdf = await PDFDocument.create();
blankPdf.addPage([612, 792]);
const scannedSource = Buffer.from(await blankPdf.save({ useObjectStreams: false }));
const [school, medical, scannedFallback] = await Promise.all([
  renderVerifiedDocument(answerSchool(schoolForm), {
    fileName: "elementary-school-intake.docx",
    format: "docx",
    bytes: schoolSource
  }),
  renderVerifiedDocument(answerMedical(medicalForm), {
    fileName: "medical-intake.pdf",
    format: "pdf",
    bytes: medicalSource
  }),
  renderVerifiedDocument(answerMedical(medicalForm), {
    fileName: "scanned-medical-intake.pdf",
    format: "pdf",
    bytes: scannedSource
  })
]);

assertNativeFixture(school, "filled_docx", 37);
assertNativeFixture(medical, "filled_pdf", 8);
if (scannedFallback.kind !== "answer_packet"
  || scannedFallback.report.fallbackCount !== 8
  || scannedFallback.report.coveragePercent !== 100
  || !scannedFallback.report.sourcePreserved) {
  throw new Error(`Answer-packet fallback failed: ${JSON.stringify(scannedFallback.report)}`);
}
const outputPdf = await PDFDocument.load(medical.bytes, { updateMetadata: false });
if (outputPdf.getForm().getTextField("patient_name").getText() !== "Taylor Morgan") {
  throw new Error("The medical renderer did not preserve the filled AcroForm value.");
}

const outputDirectory = optionValue("--out");
if (outputDirectory) {
  const directory = path.resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "elementary-school-source.docx"), schoolSource),
    writeFile(path.join(directory, school.fileName), school.bytes),
    writeFile(path.join(directory, "medical-intake-source.pdf"), medicalSource),
    writeFile(path.join(directory, medical.fileName), medical.bytes),
    writeFile(path.join(directory, scannedFallback.fileName), scannedFallback.bytes)
  ]);
}

const answerCount = school.report.answerCount + medical.report.answerCount;
const coveredCount = school.report.placedCount + school.report.fallbackCount
  + medical.report.placedCount + medical.report.fallbackCount;
console.log(JSON.stringify({
  fixtures: [summary(school), summary(medical), summary(scannedFallback)],
  aggregate: {
    answerCount,
    coveredCount,
    coveragePercent: answerCount === 0 ? 100 : Math.round(coveredCount / answerCount * 100),
    nativePlacementCount: school.report.placedCount + medical.report.placedCount,
    fallbackCount: school.report.fallbackCount + medical.report.fallbackCount,
    sourcePreservationPercent: school.report.sourcePreserved && medical.report.sourcePreserved ? 100 : 0
  },
  outputDirectory: outputDirectory ? path.resolve(outputDirectory) : null
}, null, 2));

function requireForm(id: string): FormDefinition {
  const fixture = fixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing renderer fixture: ${id}`);
  return fixture.form;
}

function answerSchool(form: FormDefinition): FormSession {
  return listFields(form).reduce(
    (session, field) => saveTextAnswer(session, field.id, `Recorded answer for ${field.id}`),
    createFormSession(form, new Date("2026-07-14T12:00:00.000Z"))
  );
}

function answerMedical(form: FormDefinition): FormSession {
  const values: Record<string, string> = {
    patient_name: "Taylor Morgan",
    date_of_birth: "1988-05-12",
    phone: "+31 20 555 0101",
    email: "taylor@example.test",
    visit_reason: "Recurring headaches",
    current_medications: "None",
    has_allergies: "Yes",
    allergy_details: "Penicillin - rash"
  };
  return listFields(form).reduce(
    (session, field) => saveTextAnswer(session, field.id, values[field.id]!),
    createFormSession(form, new Date("2026-07-14T12:00:00.000Z"))
  );
}

function assertNativeFixture(
  document: RenderedDocument,
  expectedKind: RenderedDocument["kind"],
  expectedAnswers: number
): void {
  if (document.kind !== expectedKind
    || document.report.answerCount !== expectedAnswers
    || document.report.placedCount !== expectedAnswers
    || document.report.fallbackCount !== 0
    || document.report.coveragePercent !== 100
    || !document.report.sourcePreserved
    || document.report.completionSummaryInserted) {
    throw new Error(`Renderer fixture failed: ${JSON.stringify(document.report)}`);
  }
}

function summary(document: RenderedDocument) {
  return {
    kind: document.kind,
    fileName: document.fileName,
    answerCount: document.report.answerCount,
    placedCount: document.report.placedCount,
    fallbackCount: document.report.fallbackCount,
    coveragePercent: document.report.coveragePercent,
    sourcePreserved: document.report.sourcePreserved
  };
}

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
