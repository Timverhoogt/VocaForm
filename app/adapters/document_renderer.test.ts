import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readZip } from "../../src/docx_package.mjs";
import { extractParagraphs } from "../../src/docx_text.mjs";
import { formDefinitionSchema, type FormDefinition, type FormSession } from "../domain/schemas";
import { createFormSession, listFields, saveTextAnswer } from "../domain/session";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import {
  buildMedicalPdfRenderingFixture,
  buildSchoolDocxRenderingFixture,
  withMedicalPdfTargets
} from "../evals/rendering_fixtures";
import {
  DocumentRenderError,
  renderDraftDocument,
  renderVerifiedDocument,
  type SourceDocument
} from "./document_renderer";

describe("Goal 6 document renderer", () => {
  it("reports every recorded draft answer as covered by the answer packet", async () => {
    const form = await goldenForm("activity-permission-conditional");
    const first = listFields(form)[0]!;
    const session = saveTextAnswer(createFormSession(form), first.id, "Mila Hart");

    const rendered = renderDraftDocument(session);

    expect(rendered.kind).toBe("answer_packet");
    expect(rendered.report).toMatchObject({
      answerCount: 1,
      placedCount: 0,
      fallbackCount: 1,
      coveragePercent: 100,
      sourcePreserved: false,
      completionSummaryInserted: false
    });
  });

  it("round-trips every school answer into its DOCX location without changing the source", async () => {
    const form = await goldenForm("elementary-school-docx");
    const session = answerEverySchoolField(form);
    const sourceBytes = buildSchoolDocxRenderingFixture(form);
    const sourceSnapshot = Buffer.from(sourceBytes);

    const rendered = await renderVerifiedDocument(session, {
      fileName: "elementary-school-intake.docx",
      format: "docx",
      bytes: sourceBytes
    });

    expect(sourceBytes.equals(sourceSnapshot)).toBe(true);
    expect(rendered.kind).toBe("filled_docx");
    expect(rendered.contentType).toContain("wordprocessingml.document");
    expect(rendered.fileName).toBe("elementary-school-intake-completed.docx");
    expect(rendered.report).toMatchObject({
      answerCount: 37,
      placedCount: 37,
      fallbackCount: 0,
      coveragePercent: 100,
      sourcePreserved: true,
      completionSummaryInserted: false
    });
    const outputXml = docxDocumentXml(rendered.bytes);
    const outputText = extractParagraphs(outputXml)
      .map((paragraph: { text: string }) => paragraph.text)
      .join("\n");
    for (const field of listFields(form)) {
      expect(outputText).toContain(`Recorded answer for ${field.id}`);
    }
    expect(outputText).not.toContain("Completion summary");
    expect(rendered.bytes.equals(sourceBytes)).toBe(false);
  });

  it("fills every medical AcroForm field and preserves the original PDF bytes", async () => {
    const form = withMedicalPdfTargets(await goldenForm("medical-intake-pdf"));
    const session = answerMedicalForm(form);
    const sourceBytes = await buildMedicalPdfRenderingFixture();
    const sourceSnapshot = Buffer.from(sourceBytes);

    const rendered = await renderVerifiedDocument(session, {
      fileName: "medical-intake.pdf",
      format: "pdf",
      bytes: sourceBytes
    });

    expect(sourceBytes.equals(sourceSnapshot)).toBe(true);
    expect(rendered.kind).toBe("filled_pdf");
    expect(rendered.contentType).toBe("application/pdf");
    expect(rendered.fileName).toBe("medical-intake-completed.pdf");
    expect(rendered.report).toMatchObject({
      answerCount: 8,
      placedCount: 8,
      fallbackCount: 0,
      coveragePercent: 100,
      sourcePreserved: true,
      completionSummaryInserted: false
    });

    const output = await PDFDocument.load(rendered.bytes, { updateMetadata: false });
    const outputForm = output.getForm();
    expect(output.getPageCount()).toBe(1);
    expect(outputForm.getTextField("patient_name").getText()).toBe("Taylor Morgan");
    expect(outputForm.getTextField("date_of_birth").getText()).toBe("1988-05-12");
    expect(outputForm.getTextField("phone").getText()).toBe("+31 20 555 0101");
    expect(outputForm.getTextField("email").getText()).toBe("taylor@example.test");
    expect(outputForm.getTextField("visit_reason").getText()).toBe("Recurring headaches");
    expect(outputForm.getTextField("current_medications").getText()).toBe("None");
    expect(outputForm.getRadioGroup("has_allergies").getSelected()).toBe("Yes");
    expect(outputForm.getTextField("allergy_details").getText()).toBe("Penicillin - rash");
  });

  it("keeps compatible PDF fields in place and appends an explicit fallback page", async () => {
    const sourceForm = withMedicalPdfTargets(await goldenForm("medical-intake-pdf"));
    const form = changeField(sourceForm, "allergy_details", {
      renderTargets: [{ kind: "pdf_field", locator: "missing_allergy_details", confidence: 1 }]
    });
    const sourceBytes = await buildMedicalPdfRenderingFixture();

    const rendered = await renderVerifiedDocument(answerMedicalForm(form), {
      fileName: "medical-intake.pdf",
      format: "pdf",
      bytes: sourceBytes
    });

    expect(rendered.kind).toBe("filled_pdf");
    expect(rendered.report).toMatchObject({
      answerCount: 8,
      placedCount: 7,
      fallbackCount: 1,
      coveragePercent: 100,
      sourcePreserved: true,
      completionSummaryInserted: false
    });
    const output = await PDFDocument.load(rendered.bytes, { updateMetadata: false });
    expect(output.getPageCount()).toBe(2);
    expect(output.getForm().getTextField("patient_name").getText()).toBe("Taylor Morgan");
  });

  it("appends an explicit DOCX fallback section when a verified anchor cannot be found", async () => {
    const sourceForm = await goldenForm("elementary-school-docx");
    const first = listFields(sourceForm)[0]!;
    const form = changeField(sourceForm, first.id, {
      renderTargets: [{ kind: "docx_anchor", locator: "anchor that is not present", confidence: 1 }]
    });
    const session = saveTextAnswer(createFormSession(form), first.id, "A calm and curious toddler.");
    const sourceBytes = buildSchoolDocxRenderingFixture(sourceForm);

    const rendered = await renderVerifiedDocument(session, {
      fileName: "elementary-school-intake.docx",
      format: "docx",
      bytes: sourceBytes
    });

    expect(rendered.report).toMatchObject({
      answerCount: 1,
      placedCount: 0,
      fallbackCount: 1,
      coveragePercent: 100
    });
    const outputText = extractParagraphs(docxDocumentXml(rendered.bytes))
      .map((paragraph: { text: string }) => paragraph.text)
      .join("\n");
    expect(outputText).toContain("Answers not placed in the original");
    expect(outputText).toContain("A calm and curious toddler.");
    expect(outputText).toContain("Original document: elementary-school-intake.docx");
  });

  it("returns a polished section-matched answer packet for a non-writable PDF", async () => {
    const form = withMedicalPdfTargets(await goldenForm("medical-intake-pdf"));
    const session = answerMedicalForm(form);
    const blankPdf = await PDFDocument.create();
    blankPdf.addPage([612, 792]);
    const sourceBytes = Buffer.from(await blankPdf.save({ useObjectStreams: false }));
    const sourceSnapshot = Buffer.from(sourceBytes);

    const rendered = await renderVerifiedDocument(session, {
      fileName: "scanned-medical-intake.pdf",
      format: "pdf",
      bytes: sourceBytes
    });

    expect(sourceBytes.equals(sourceSnapshot)).toBe(true);
    expect(rendered.kind).toBe("answer_packet");
    expect(rendered.fileName.endsWith("verified-answer-packet.docx")).toBe(true);
    expect(rendered.report).toMatchObject({
      answerCount: 8,
      placedCount: 0,
      fallbackCount: 8,
      coveragePercent: 100,
      sourcePreserved: true,
      completionSummaryInserted: false
    });
    const outputText = extractParagraphs(docxDocumentXml(rendered.bytes))
      .map((paragraph: { text: string }) => paragraph.text)
      .join("\n");
    expect(outputText).toContain("COMPLETED ANSWER PACKET");
    expect(outputText).toContain("Patient details");
    expect(outputText).toContain("Visit details");
    expect(outputText).toContain("Original document: scanned-medical-intake.pdf");
    expect(outputText).not.toContain("Completion summary");
  });

  it("blocks export rather than hiding a failed manual-review placement", async () => {
    const sourceForm = await goldenForm("elementary-school-docx");
    const first = listFields(sourceForm)[0]!;
    const form = changeField(sourceForm, first.id, {
      renderTargets: [{ kind: "docx_anchor", locator: "missing manual anchor", confidence: 1 }],
      renderFallback: "manual_review"
    });
    const session = saveTextAnswer(createFormSession(form), first.id, "Explicit answer");
    const source: SourceDocument = {
      fileName: "elementary-school-intake.docx",
      format: "docx",
      bytes: buildSchoolDocxRenderingFixture(sourceForm)
    };

    await expect(renderVerifiedDocument(session, source)).rejects.toBeInstanceOf(DocumentRenderError);
  });
});

async function goldenForm(id: string): Promise<FormDefinition> {
  const fixture = (await loadGoldenCompilerFixtures()).find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing fixture: ${id}`);
  return fixture.form;
}

function answerEverySchoolField(form: FormDefinition): FormSession {
  return listFields(form).reduce(
    (session, field) => saveTextAnswer(session, field.id, `Recorded answer for ${field.id}`),
    createFormSession(form, new Date("2026-07-14T12:00:00.000Z"))
  );
}

function answerMedicalForm(form: FormDefinition): FormSession {
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

function changeField(
  form: FormDefinition,
  fieldId: string,
  changes: Partial<FormDefinition["sections"][number]["fields"][number]>
): FormDefinition {
  return formDefinitionSchema.parse({
    ...form,
    sections: form.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => field.id === fieldId ? { ...field, ...changes } : field)
    }))
  });
}

function docxDocumentXml(bytes: Buffer): string {
  const entry = readZip(bytes).find((candidate: { name: string }) => candidate.name === "word/document.xml");
  if (!entry) throw new Error("DOCX body missing.");
  return entry.data.toString("utf8");
}
