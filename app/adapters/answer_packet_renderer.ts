import { writeZip } from "../../src/docx_package.mjs";
import { isFieldApplicable } from "../domain/session";
import type { AnswerRecord, FormSession } from "../domain/schemas";

export interface AnswerPacketOptions {
  title: string;
  status: "draft" | "verified" | "fallback";
  sourceFileName?: string;
  fallbackReason?: string;
  fieldIds?: ReadonlySet<string>;
}

interface PacketAnswer {
  fieldId: string;
  label: string;
  value: string;
}

interface PacketSection {
  title: string;
  answers: PacketAnswer[];
}

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function buildAnswerPacketDocx(session: FormSession, options: AnswerPacketOptions): Buffer {
  const sections = packetSections(session, options.fieldIds);
  const profileAnswers = packetProfileAnswers(session, options.fieldIds);
  const body = [
    paragraph(statusLabel(options.status), "PacketKicker"),
    paragraph(options.title, "PacketTitle"),
    paragraph(session.form.title, "PacketSubtitle"),
    paragraph(`Original document: ${options.sourceFileName ?? session.form.source.fileName}`, "PacketSource"),
    noteParagraph(packetExplanation(options)),
    ...profileSection(profileAnswers),
    ...sections.flatMap((section) => [
      paragraph(section.title, "Heading1"),
      ...section.answers.flatMap((answer) => [
        paragraph(answer.label, "PacketQuestion"),
        paragraph(answer.value, "PacketAnswer")
      ])
    ]),
    sections.length === 0 && profileAnswers.length === 0
      ? noteParagraph("No answers have been recorded yet.")
      : "",
    sectionProperties()
  ].join("");

  const documentXml = xml([
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<w:body>${body}</w:body>`,
    "</w:document>"
  ]);

  return writeZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml(), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(packageRelationshipsXml(), "utf8") },
    { name: "docProps/app.xml", data: Buffer.from(appPropertiesXml(), "utf8") },
    { name: "docProps/core.xml", data: Buffer.from(corePropertiesXml(options.title, session.form.locale), "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "word/styles.xml", data: Buffer.from(stylesXml(session.form.locale), "utf8") },
    { name: "word/header1.xml", data: Buffer.from(headerXml(), "utf8") },
    { name: "word/footer1.xml", data: Buffer.from(footerXml(), "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(documentRelationshipsXml(), "utf8") }
  ]);
}

export function answerPacketContentType(): string {
  return CONTENT_TYPE;
}

function packetSections(session: FormSession, fieldIds?: ReadonlySet<string>): PacketSection[] {
  return session.form.sections.map((section) => ({
    title: section.title,
    answers: section.fields
      .filter((field) => !fieldIds || fieldIds.has(field.id))
      .filter((field) => isFieldApplicable(session, field))
      .map((field) => ({
        fieldId: field.id,
        label: field.label,
        value: formatAnswer(session.answers[field.id] ?? session.prefillAnswers[field.id])
      }))
  })).filter((section) => section.answers.length > 0);
}

function packetProfileAnswers(session: FormSession, fieldIds?: ReadonlySet<string>): PacketAnswer[] {
  const interviewFieldIds = new Set(session.form.sections.flatMap((section) => section.fields.map((field) => field.id)));
  return session.form.prefillFields
    .filter((field) => !interviewFieldIds.has(field.id))
    .filter((field) => !fieldIds || fieldIds.has(field.id))
    .map((field) => ({
      fieldId: field.id,
      label: field.label,
      value: formatAnswer(session.prefillAnswers[field.id])
    }));
}

function profileSection(answers: PacketAnswer[]): string[] {
  if (answers.length === 0) return [];
  return [
    paragraph("Profile details", "Heading1"),
    ...answers.flatMap((answer) => [
      paragraph(answer.label, "PacketQuestion"),
      paragraph(answer.value, "PacketAnswer")
    ])
  ];
}

function formatAnswer(answer: AnswerRecord | undefined): string {
  if (!answer || answer.status === "unanswered") return "Not answered.";
  if (answer.status === "skipped") return "Intentionally left blank.";
  if (answer.status === "needs_followup") {
    const value = answer.normalizedAnswer ?? answer.rawAnswer ?? "Needs clarification.";
    return answer.followUpQuestion ? `${value} Follow-up: ${answer.followUpQuestion}` : value;
  }
  if (Array.isArray(answer.value)) return answer.value.join(", ");
  if (typeof answer.value === "boolean") return answer.value ? "Yes" : "No";
  if (answer.value !== null) return String(answer.value);
  return answer.normalizedAnswer ?? answer.rawAnswer ?? "Not answered.";
}

function statusLabel(status: AnswerPacketOptions["status"]): string {
  return ({
    draft: "DRAFT ANSWER PACKET",
    verified: "VERIFIED ANSWER PACKET",
    fallback: "COMPLETED ANSWER PACKET"
  } as const)[status];
}

function packetExplanation(options: AnswerPacketOptions): string {
  if (options.status === "draft") {
    return "This draft is for review. Check every answer before sharing it with the organization that supplied the form.";
  }
  if (options.status === "fallback") {
    const reason = options.fallbackReason ? ` ${options.fallbackReason}` : "";
    return `This packet accompanies the unchanged original document because one or more answers could not be placed safely in it.${reason}`;
  }
  return "VocaForm verified the current session before creating this packet. The original source document remains unchanged.";
}

function paragraph(text: string, style: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function noteParagraph(text: string): string {
  return [
    "<w:p><w:pPr><w:pStyle w:val=\"PacketNote\"/><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"EDF4F0\"/>",
    "<w:ind w:left=\"180\" w:right=\"180\"/><w:spacing w:before=\"100\" w:after=\"180\"/></w:pPr>",
    `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  ].join("");
}

function sectionProperties(): string {
  return [
    "<w:sectPr>",
    '<w:headerReference w:type="default" r:id="rId2"/>',
    '<w:footerReference w:type="default" r:id="rId3"/>',
    '<w:pgSz w:w="12240" w:h="15840"/>',
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>',
    "</w:sectPr>"
  ].join("");
}

function stylesXml(locale: string): string {
  return xml([
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
    `<w:lang w:val="${escapeXml(locale)}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="17352D"/></w:rPr></w:rPrDefault>`,
    '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
    style("Normal", "Normal", '<w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="17352D"/></w:rPr>'),
    style("PacketKicker", "Packet kicker", '<w:basedOn w:val="Normal"/><w:next w:val="PacketTitle"/><w:pPr><w:spacing w:before="40" w:after="0"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="426A5A"/><w:sz w:val="18"/><w:caps/></w:rPr>'),
    style("PacketTitle", "Packet title", '<w:basedOn w:val="Normal"/><w:next w:val="PacketSubtitle"/><w:pPr><w:spacing w:before="0" w:after="100"/><w:keepNext/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="17352D"/><w:sz w:val="52"/></w:rPr>'),
    style("PacketSubtitle", "Packet subtitle", '<w:basedOn w:val="Normal"/><w:next w:val="PacketSource"/><w:pPr><w:spacing w:before="0" w:after="60"/><w:keepNext/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="425A52"/><w:sz w:val="28"/></w:rPr>'),
    style("PacketSource", "Packet source", '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="180"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:i/><w:color w:val="61716B"/><w:sz w:val="19"/></w:rPr>'),
    style("Heading1", "Heading 1", '<w:basedOn w:val="Normal"/><w:next w:val="PacketQuestion"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="200"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr>'),
    style("Heading2", "Heading 2", '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/></w:pPr>', '<w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/></w:rPr>'),
    style("PacketQuestion", "Packet question", '<w:basedOn w:val="Normal"/><w:next w:val="PacketAnswer"/><w:pPr><w:keepNext/><w:spacing w:before="100" w:after="40" w:line="280" w:lineRule="auto"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="17352D"/><w:sz w:val="21"/></w:rPr>'),
    style("PacketAnswer", "Packet answer", '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="140" w:line="300" w:lineRule="auto"/><w:ind w:left="180"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="273E36"/><w:sz w:val="22"/></w:rPr>'),
    style("PacketNote", "Packet note", '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="100" w:after="180" w:line="280" w:lineRule="auto"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="274C3E"/><w:sz w:val="20"/></w:rPr>'),
    "</w:styles>"
  ]);
}

function style(id: string, name: string, paragraphProperties: string, runProperties: string): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${paragraphProperties}${runProperties}</w:style>`;
}

function headerXml(): string {
  return xml([
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:p><w:pPr><w:spacing w:after="0"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="CAD8D1"/></w:pBdr></w:pPr>',
    '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="426A5A"/><w:sz w:val="17"/></w:rPr><w:t>VOCAFORM</w:t></w:r>',
    '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="61716B"/><w:sz w:val="17"/></w:rPr><w:t xml:space="preserve">  |  Answer packet</w:t></w:r>',
    "</w:p></w:hdr>"
  ]);
}

function footerXml(): string {
  return xml([
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="0" w:after="0"/></w:pPr>',
    '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="61716B"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">VocaForm  |  page </w:t></w:r>',
    '<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:color w:val="61716B"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>',
    "</w:p></w:ftr>"
  ]);
}

function contentTypesXml(): string {
  return xml([
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    "</Types>"
  ]);
}

function packageRelationshipsXml(): string {
  return xml([
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    "</Relationships>"
  ]);
}

function documentRelationshipsXml(): string {
  return xml([
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    "</Relationships>"
  ]);
}

function corePropertiesXml(title: string, locale: string): string {
  return xml([
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"',
    ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<dc:title>${escapeXml(title)}</dc:title><dc:creator>VocaForm</dc:creator>`,
    `<dc:language>${escapeXml(locale)}</dc:language>`,
    "<dc:description>Completed answers generated from a user-verified VocaForm session.</dc:description>",
    "</cp:coreProperties>"
  ]);
}

function appPropertiesXml(): string {
  return xml([
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"',
    ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    "<Application>VocaForm</Application><AppVersion>0.2</AppVersion>",
    "</Properties>"
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
