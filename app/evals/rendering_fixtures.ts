import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFForm,
  type PDFPage
} from "pdf-lib";
import { writeZip } from "../../src/docx_package.mjs";
import { formDefinitionSchema, type FormDefinition } from "../domain/schemas";

export function buildSchoolDocxRenderingFixture(form: FormDefinition): Buffer {
  const body = [
    paragraph("SCHOOL START QUESTIONNAIRE", "TemplateKicker"),
    paragraph(form.title, "TemplateTitle"),
    paragraph("A synthetic form used to verify safe in-place rendering. Questions marked with * are required.", "TemplateIntro"),
    ...form.sections.flatMap((section) => [
      paragraph(section.title, "Heading1"),
      ...section.fields.flatMap((field) => [
        paragraph(`${anchorFor(field)}${field.required ? "  *" : ""}`, "FormQuestion"),
        paragraph("Answer", "FormAnswerLine")
      ])
    ]),
    '<w:p><w:pPr><w:spacing w:before="240"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="61716B"/><w:sz w:val="17"/></w:rPr><w:t>This synthetic form contains no real child or family data.</w:t></w:r></w:p>',
    '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/>',
    '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
  ].join("");
  const documentXml = xml([
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<w:body>${body}</w:body></w:document>`
  ]);
  return writeZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes(), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(packageRelationships(), "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "word/styles.xml", data: Buffer.from(templateStyles(), "utf8") },
    { name: "word/header1.xml", data: Buffer.from(templateHeader(), "utf8") },
    { name: "word/footer1.xml", data: Buffer.from(templateFooter(), "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(documentRelationships(), "utf8") }
  ]);
}

export async function buildMedicalPdfRenderingFixture(): Promise<Buffer> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle("Riverside Family Practice - New Patient Intake");
  pdf.setAuthor("VocaForm synthetic evaluation fixture");
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();

  page.drawRectangle({ x: 44, y: 666, width: 524, height: 82, color: rgb(0.93, 0.96, 0.94) });
  page.drawText("NEW PATIENT INTAKE", { x: 62, y: 722, size: 9, font: bold, color: rgb(0.26, 0.42, 0.35) });
  page.drawText("Riverside Family Practice", { x: 62, y: 692, size: 22, font: bold, color: rgb(0.09, 0.21, 0.18) });
  page.drawText("Synthetic fillable form", { x: 454, y: 722, size: 8, font, color: rgb(0.38, 0.44, 0.42) });

  let y = 638;
  y = pdfSection(page, bold, "PATIENT DETAILS", y);
  y = addTextField(form, page, font, bold, "patient_name", "Full legal name (required):", y, 22);
  y = addTextField(form, page, font, bold, "date_of_birth", "Date of birth (required):", y, 22);
  y = addTextField(form, page, font, bold, "phone", "Phone number (required):", y, 22);
  y = addTextField(form, page, font, bold, "email", "Email address (optional):", y, 22);
  y -= 6;
  y = pdfSection(page, bold, "VISIT DETAILS", y);
  y = addTextField(form, page, font, bold, "visit_reason", "Reason for today's visit (required):", y, 48, true);
  y = addTextField(form, page, font, bold, "current_medications", "List current medications, or write none:", y, 48, true);

  page.drawText("Do you have any known allergies? Yes / No (required)", {
    x: 62,
    y,
    size: 10.5,
    font: bold,
    color: rgb(0.09, 0.21, 0.18)
  });
  const allergyGroup = form.createRadioGroup("has_allergies");
  allergyGroup.addOptionToPage("Yes", page, fieldAppearance(410, y - 6, 12, 12, font));
  allergyGroup.addOptionToPage("No", page, fieldAppearance(474, y - 6, 12, 12, font));
  page.drawText("Yes", { x: 428, y: y - 3, size: 9, font, color: rgb(0.09, 0.21, 0.18) });
  page.drawText("No", { x: 492, y: y - 3, size: 9, font, color: rgb(0.09, 0.21, 0.18) });
  y -= 34;
  addTextField(form, page, font, bold, "allergy_details", "If yes, list the allergies and reactions:", y, 48, true);

  page.drawLine({ start: { x: 62, y: 48 }, end: { x: 550, y: 48 }, thickness: 0.6, color: rgb(0.79, 0.85, 0.82) });
  page.drawText("This is synthetic demonstration paperwork. It contains no real patient data.", {
    x: 62,
    y: 32,
    size: 8,
    font,
    color: rgb(0.38, 0.44, 0.42)
  });

  form.updateFieldAppearances(font);
  return Buffer.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

export function withMedicalPdfTargets(form: FormDefinition): FormDefinition {
  return formDefinitionSchema.parse({
    ...form,
    sections: form.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({
        ...field,
        renderTargets: [{ kind: "pdf_field", locator: field.id, confidence: 1 }],
        renderFallback: "append_answer_packet"
      }))
    }))
  });
}

function addTextField(
  form: PDFForm,
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  name: string,
  label: string,
  y: number,
  height: number,
  multiline = false
): number {
  page.drawText(label, { x: 62, y, size: 10.5, font: bold, color: rgb(0.09, 0.21, 0.18) });
  const field = form.createTextField(name);
  if (multiline) field.enableMultiline();
  field.addToPage(page, {
    x: 62,
    y: y - height - 8,
    width: 488,
    height,
    font,
    textColor: rgb(0.09, 0.21, 0.18),
    backgroundColor: rgb(1, 1, 1),
    borderColor: rgb(0.66, 0.73, 0.70),
    borderWidth: 0.8
  });
  field.setFontSize(10);
  return y - height - 27;
}

function fieldAppearance(x: number, y: number, width: number, height: number, font: PDFFont) {
  return {
    x,
    y,
    width,
    height,
    font,
    textColor: rgb(0.09, 0.21, 0.18),
    backgroundColor: rgb(1, 1, 1),
    borderColor: rgb(0.26, 0.42, 0.35),
    borderWidth: 0.8
  };
}

function pdfSection(page: PDFPage, bold: PDFFont, title: string, y: number): number {
  page.drawText(title, { x: 62, y, size: 10, font: bold, color: rgb(0.26, 0.42, 0.35) });
  page.drawLine({ start: { x: 62, y: y - 7 }, end: { x: 550, y: y - 7 }, thickness: 0.7, color: rgb(0.61, 0.72, 0.67) });
  return y - 29;
}

function anchorFor(field: FormDefinition["sections"][number]["fields"][number]): string {
  return field.renderTargets.find((target) => target.kind === "docx_anchor")?.locator ?? field.label;
}

function paragraph(text: string, style: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function templateStyles(): string {
  return xml([
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="17352D"/></w:rPr></w:rPrDefault>',
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
    style("Normal", "Normal", '<w:qFormat/><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="17352D"/></w:rPr>'),
    style("TemplateKicker", "Template kicker", '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="40" w:after="0"/></w:pPr>', '<w:rPr><w:b/><w:caps/><w:color w:val="426A5A"/><w:sz w:val="18"/></w:rPr>'),
    style("TemplateTitle", "Template title", '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="100"/><w:keepNext/></w:pPr>', '<w:rPr><w:b/><w:color w:val="17352D"/><w:sz w:val="52"/></w:rPr>'),
    style("TemplateIntro", "Template intro", '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="220"/></w:pPr>', '<w:rPr><w:color w:val="425A52"/><w:sz w:val="22"/></w:rPr>'),
    style("Heading1", "Heading 1", '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:keepNext/><w:spacing w:before="360" w:after="160"/></w:pPr>', '<w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr>'),
    style("FormQuestion", "Form question", '<w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="80" w:after="30" w:line="270" w:lineRule="auto"/></w:pPr>', '<w:rPr><w:b/><w:color w:val="17352D"/><w:sz w:val="21"/></w:rPr>'),
    style("FormAnswerLine", "Form answer line", '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="120"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="3" w:color="A9BBB2"/></w:pBdr></w:pPr>', '<w:rPr><w:color w:val="61716B"/><w:sz w:val="18"/></w:rPr>'),
    "</w:styles>"
  ]);
}

function style(id: string, name: string, paragraphProperties: string, runProperties: string): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${paragraphProperties}${runProperties}</w:style>`;
}

function templateHeader(): string {
  return xml([
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="CAD8D1"/></w:pBdr></w:pPr>',
    '<w:r><w:rPr><w:b/><w:color w:val="426A5A"/><w:sz w:val="17"/></w:rPr><w:t>SYNTHETIC SCHOOL FORM</w:t></w:r>',
    "</w:p></w:hdr>"
  ]);
}

function templateFooter(): string {
  return xml([
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>',
    '<w:r><w:rPr><w:color w:val="61716B"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">VocaForm rendering fixture  |  page </w:t></w:r>',
    '<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:color w:val="61716B"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>',
    "</w:p></w:ftr>"
  ]);
}

function contentTypes(): string {
  return xml([
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    "</Types>"
  ]);
}

function packageRelationships(): string {
  return xml([
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    "</Relationships>"
  ]);
}

function documentRelationships(): string {
  return xml([
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    "</Relationships>"
  ]);
}

function xml(parts: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${parts.join("")}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
