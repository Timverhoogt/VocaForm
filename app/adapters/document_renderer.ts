import { createHash } from "node:crypto";
import path from "node:path";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFField,
  type PDFPage
} from "pdf-lib";
import { readZip, writeZip } from "../../src/docx_package.mjs";
import { extractParagraphs, normalizeText } from "../../src/docx_text.mjs";
import { isFieldApplicable } from "../domain/session";
import type {
  AnswerRecord,
  FormField,
  FormSession,
  RenderTarget
} from "../domain/schemas";
import type { DocumentExportPlan, ExportDocumentKind } from "../shared/api";
import { answerPacketContentType, buildAnswerPacketDocx } from "./answer_packet_renderer";

export type RenderedDocumentKind = ExportDocumentKind;

export interface SourceDocument {
  fileName: string;
  format: "docx" | "pdf" | "text";
  bytes: Buffer;
}

export interface RenderPlacement {
  fieldId: string;
  targetKind: "docx_anchor" | "pdf_field" | "answer_packet";
  locator: string;
  result: "placed" | "fallback";
  detail: string;
}

export interface DocumentRenderReport {
  kind: RenderedDocumentKind;
  sourceFileName: string;
  sourceSha256: string | null;
  outputSha256: string;
  sourcePreserved: boolean;
  answerCount: number;
  placedCount: number;
  fallbackCount: number;
  coveragePercent: number;
  completionSummaryInserted: false;
  placements: RenderPlacement[];
}

export interface RenderedDocument {
  bytes: Buffer;
  contentType: string;
  fileName: string;
  kind: RenderedDocumentKind;
  report: DocumentRenderReport;
}

export class DocumentRenderError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface RenderAnswer {
  fieldId: string;
  label: string;
  sectionTitle: string;
  value: string;
  answer: AnswerRecord;
  targets: RenderTarget[];
  renderFallback: FormField["renderFallback"];
}

interface DocxModification {
  start: number;
  end: number;
  replacement: string;
}

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_CONTENT_TYPE = "application/pdf";

export function buildDocumentExportPlan(
  session: FormSession,
  source: SourceDocument | null
): DocumentExportPlan {
  if (source?.format === "docx") {
    return {
      kind: "filled_docx",
      sourceAvailable: true,
      sourceFileName: source.fileName,
      buttonLabel: "Download verified DOCX",
      description: "Answers will be placed in a new copy of the original Word document."
    };
  }
  if (source?.format === "pdf" && hasRenderTarget(session, "pdf_field")) {
    return {
      kind: "filled_pdf",
      sourceAvailable: true,
      sourceFileName: source.fileName,
      buttonLabel: "Download verified PDF",
      description: "Fillable fields will be completed in a new PDF; any unmatched answers get an explicit fallback page."
    };
  }
  return {
    kind: "answer_packet",
    sourceAvailable: source !== null,
    sourceFileName: source?.fileName ?? session.form.source.fileName,
    buttonLabel: "Download verified DOCX answer packet",
    description: "The original cannot be filled safely, so VocaForm will create a section-matched answer packet."
  };
}

export function renderDraftDocument(session: FormSession): RenderedDocument {
  const entries = renderAnswers(session);
  const bytes = buildAnswerPacketDocx(session, {
    title: "VocaForm draft answers",
    status: "draft"
  });
  return answerPacketResult(session, bytes, "draft", null, [], entries);
}

export async function renderVerifiedDocument(
  session: FormSession,
  source: SourceDocument | null
): Promise<RenderedDocument> {
  if (!source) {
    const entries = renderAnswers(session);
    const bytes = buildAnswerPacketDocx(session, {
      title: "VocaForm verified answer packet",
      status: "verified"
    });
    return answerPacketResult(session, bytes, "verified", null, [], entries);
  }
  if (source.format !== session.form.source.format && session.form.source.format !== "fixture") {
    throw new DocumentRenderError("The retained source does not match the active form.");
  }
  if (source.format === "docx") return renderDocx(session, source);
  if (source.format === "pdf") return renderPdf(session, source);

  const sourceSnapshot = Buffer.from(source.bytes);
  const entries = renderAnswers(session);
  const bytes = buildAnswerPacketDocx(session, {
    title: "VocaForm completed answer packet",
    status: "fallback",
    sourceFileName: source.fileName,
    fallbackReason: "Plain-text sources do not provide writable document fields."
  });
  assertSourcePreserved(source.bytes, sourceSnapshot);
  return answerPacketResult(session, bytes, "fallback", source, [], entries);
}

function renderDocx(session: FormSession, source: SourceDocument): RenderedDocument {
  requireDocx(source.bytes);
  const sourceSnapshot = Buffer.from(source.bytes);
  const entries = readZip(sourceSnapshot);
  const documentEntry = entries.find((entry: { name: string }) => entry.name === "word/document.xml");
  if (!documentEntry) throw new DocumentRenderError("The retained DOCX has no Word document body.");

  let documentXml = documentEntry.data.toString("utf8");
  const answers = renderAnswers(session);
  const placements: RenderPlacement[] = [];
  const fallback: RenderAnswer[] = [];

  for (const answer of answers) {
    const targets = answer.targets.filter((target) => target.kind === "docx_anchor");
    let placed = false;
    for (const target of targets) {
      const result = placeDocxAnswer(documentXml, target.locator, answer.value);
      if (!result) continue;
      documentXml = result.documentXml;
      placements.push({
        fieldId: answer.fieldId,
        targetKind: "docx_anchor",
        locator: target.locator,
        result: "placed",
        detail: result.detail
      });
      placed = true;
      break;
    }
    if (placed) continue;
    if (answer.renderFallback !== "append_answer_packet") {
      throw new DocumentRenderError(`“${answer.label}” could not be placed and requires manual review.`);
    }
    fallback.push(answer);
    placements.push({
      fieldId: answer.fieldId,
      targetKind: "answer_packet",
      locator: answer.fieldId,
      result: "fallback",
      detail: targets.length > 0 ? "The DOCX anchor was not found." : "No DOCX anchor was supplied."
    });
  }

  if (fallback.length > 0) {
    documentXml = appendToDocumentXml(documentXml, docxFallbackXml(source.fileName, fallback));
  }
  documentEntry.data = Buffer.from(documentXml, "utf8");
  const output = writeZip(entries);
  assertSourcePreserved(source.bytes, sourceSnapshot);
  return renderedResult(
    session,
    output,
    DOCX_CONTENT_TYPE,
    completedFileName(source.fileName, "docx"),
    "filled_docx",
    source,
    placements
  );
}

async function renderPdf(session: FormSession, source: SourceDocument): Promise<RenderedDocument> {
  requirePdf(source.bytes);
  const sourceSnapshot = Buffer.from(source.bytes);
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(Uint8Array.from(sourceSnapshot), {
      ignoreEncryption: false,
      updateMetadata: false
    });
  } catch (error) {
    throw new DocumentRenderError(`The retained PDF could not be opened: ${errorMessage(error)}`);
  }

  const answers = renderAnswers(session);
  const form = pdf.getForm();
  const fields = new Map(form.getFields().map((field) => [field.getName(), field]));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const placements: RenderPlacement[] = [];
  const fallback: RenderAnswer[] = [];

  for (const answer of answers) {
    const targets = answer.targets.filter((target) => target.kind === "pdf_field");
    let placed = false;
    for (const target of targets) {
      const field = fields.get(target.locator);
      if (!field) continue;
      try {
        if (!fillPdfField(field, answer, font)) continue;
      } catch {
        continue;
      }
      placements.push({
        fieldId: answer.fieldId,
        targetKind: "pdf_field",
        locator: target.locator,
        result: "placed",
        detail: `Filled ${field.constructor.name}.`
      });
      placed = true;
      break;
    }
    if (placed) continue;
    if (answer.renderFallback !== "append_answer_packet") {
      throw new DocumentRenderError(`“${answer.label}” could not be placed and requires manual review.`);
    }
    fallback.push(answer);
    placements.push({
      fieldId: answer.fieldId,
      targetKind: "answer_packet",
      locator: answer.fieldId,
      result: "fallback",
      detail: targets.length > 0 ? "The named PDF field was missing or incompatible." : "No PDF field was supplied."
    });
  }

  if (answers.length > 0 && placements.every((placement) => placement.result === "fallback")) {
    const bytes = buildAnswerPacketDocx(session, {
      title: "VocaForm completed answer packet",
      status: "fallback",
      sourceFileName: source.fileName,
      fallbackReason: "The PDF does not contain compatible fillable fields.",
      fieldIds: new Set(answers.map((answer) => answer.fieldId))
    });
    assertSourcePreserved(source.bytes, sourceSnapshot);
    return answerPacketResult(session, bytes, "fallback", source, placements, answers);
  }

  if (fallback.length > 0) {
    if (!canEncodeFallback(font, source.fileName, fallback)) {
      const bytes = buildAnswerPacketDocx(session, {
        title: "VocaForm completed answer packet",
        status: "fallback",
        sourceFileName: source.fileName,
        fallbackReason: "Some answers use characters that cannot be embedded safely in this PDF.",
        fieldIds: new Set(answers.map((answer) => answer.fieldId))
      });
      assertSourcePreserved(source.bytes, sourceSnapshot);
      return answerPacketResult(session, bytes, "fallback", source, placements.map((placement) => ({
        ...placement,
        targetKind: "answer_packet",
        locator: placement.fieldId,
        result: "fallback",
        detail: "Returned in the explicit answer packet."
      })), answers);
    }
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    appendPdfFallbackPages(pdf, source.fileName, fallback, font, bold);
  }
  form.updateFieldAppearances(font);
  const output = Buffer.from(await pdf.save({
    useObjectStreams: false,
    updateFieldAppearances: false
  }));
  assertSourcePreserved(source.bytes, sourceSnapshot);
  return renderedResult(
    session,
    output,
    PDF_CONTENT_TYPE,
    completedFileName(source.fileName, "pdf"),
    "filled_pdf",
    source,
    placements
  );
}

function fillPdfField(field: PDFField, answer: RenderAnswer, font: PDFFont): boolean {
  const blank = answer.answer.status === "skipped";
  if (field instanceof PDFTextField) {
    const value = blank ? "" : answer.value;
    font.encodeText(value);
    field.setText(value);
    return true;
  }
  if (field instanceof PDFCheckBox) {
    if (!blank && answer.answer.value === true) field.check();
    else field.uncheck();
    return true;
  }
  if (field instanceof PDFRadioGroup) {
    if (blank) {
      field.clear();
      return true;
    }
    const option = matchingOption(field.getOptions(), answer.value);
    if (!option) return false;
    field.select(option);
    return true;
  }
  if (field instanceof PDFDropdown) {
    if (blank) {
      field.clear();
      return true;
    }
    const values = Array.isArray(answer.answer.value) ? answer.answer.value : [answer.value];
    const selected = values.map((value) => matchingOption(field.getOptions(), String(value)))
      .filter((value): value is string => Boolean(value));
    if (selected.length !== values.length) return false;
    field.select(selected.length === 1 ? selected[0] as string : selected);
    return true;
  }
  if (field instanceof PDFOptionList) {
    if (blank) {
      field.clear();
      return true;
    }
    const values = Array.isArray(answer.answer.value) ? answer.answer.value : [answer.value];
    const selected = values.map((value) => matchingOption(field.getOptions(), String(value)))
      .filter((value): value is string => Boolean(value));
    if (selected.length !== values.length) return false;
    field.select(selected);
    return true;
  }
  return false;
}

function matchingOption(options: string[], value: string): string | null {
  const normalized = normalizeComparable(value);
  return options.find((option) => normalizeComparable(option) === normalized) ?? null;
}

function renderAnswers(session: FormSession): RenderAnswer[] {
  const results: RenderAnswer[] = [];
  const interviewFieldIds = new Set<string>();
  for (const section of session.form.sections) {
    for (const field of section.fields) {
      interviewFieldIds.add(field.id);
      if (!isFieldApplicable(session, field)) continue;
      const answer = session.answers[field.id] ?? session.prefillAnswers[field.id];
      if (!isRenderableAnswer(answer)) continue;
      results.push({
        fieldId: field.id,
        label: field.label,
        sectionTitle: section.title,
        value: answerValue(answer),
        answer,
        targets: field.renderTargets,
        renderFallback: field.renderFallback
      });
    }
  }
  for (const field of session.form.prefillFields) {
    if (interviewFieldIds.has(field.id)) continue;
    const answer = session.prefillAnswers[field.id];
    if (!isRenderableAnswer(answer)) continue;
    results.push({
      fieldId: field.id,
      label: field.label,
      sectionTitle: "Profile details",
      value: answerValue(answer),
      answer,
      targets: inferredPrefillTargets(session, field.id, field.label),
      renderFallback: "append_answer_packet"
    });
  }
  return results;
}

function inferredPrefillTargets(session: FormSession, fieldId: string, label: string): RenderTarget[] {
  if (session.form.source.format === "docx") {
    return [{ kind: "docx_anchor", locator: label, confidence: 0.8 }];
  }
  if (session.form.source.format === "pdf") {
    return [{ kind: "pdf_field", locator: fieldId, confidence: 0.8 }];
  }
  return [{ kind: "answer_packet", locator: fieldId, confidence: 1 }];
}

function isRenderableAnswer(answer: AnswerRecord | undefined): answer is AnswerRecord {
  return Boolean(answer && answer.status !== "unanswered");
}

function answerValue(answer: AnswerRecord): string {
  if (answer.status === "skipped") return "Intentionally left blank";
  if (Array.isArray(answer.value)) return answer.value.join(", ");
  if (typeof answer.value === "boolean") return answer.value ? "Yes" : "No";
  if (answer.value !== null) return String(answer.value);
  return answer.normalizedAnswer ?? answer.rawAnswer ?? "";
}

function placeDocxAnswer(
  documentXml: string,
  anchor: string,
  value: string
): { documentXml: string; detail: string } | null {
  const normalizedAnchor = normalizeText(anchor);
  if (!normalizedAnchor) return null;
  const paragraphs = extractParagraphs(documentXml);
  const anchorIndex = paragraphs.findIndex((paragraph: { text: string }) =>
    normalizeText(paragraph.text).includes(normalizedAnchor)
  );
  if (anchorIndex < 0) return null;
  const anchorParagraph = paragraphs[anchorIndex] as {
    start: number;
    end: number;
    xml: string;
  };
  const next = paragraphs[anchorIndex + 1] as {
    start: number;
    end: number;
    xml: string;
    text: string;
  } | undefined;
  let modification: DocxModification;
  let detail: string;
  if (next && isAnswerPlaceholder(next)) {
    modification = {
      start: next.start,
      end: next.end,
      replacement: replaceParagraphText(next.xml, value)
    };
    detail = "Replaced the answer placeholder following the matched anchor.";
  } else {
    modification = {
      start: anchorParagraph.end,
      end: anchorParagraph.end,
      replacement: insertedAnswerParagraph(value)
    };
    detail = "Inserted the answer directly after the matched anchor.";
  }
  return {
    documentXml: applyModifications(documentXml, [modification]),
    detail
  };
}

function isAnswerPlaceholder(paragraph: { xml: string; text: string }): boolean {
  if (/w:pStyle w:val="(?:FormAnswerLine|Form Answer Line)"/i.test(paragraph.xml)) return true;
  const text = normalizeText(paragraph.text).replace(/[_.-]+/g, "").trim();
  return text === "" || ["answer", "antwoord", "response", "your answer"].includes(text);
}

function replaceParagraphText(paragraphXml: string, value: string): string {
  const opening = paragraphXml.match(/^<w:p\b[^>]*>/)?.[0] ?? "<w:p>";
  const properties = paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  return `${opening}${properties}${answerRun(value)}</w:p>`;
}

function insertedAnswerParagraph(value: string): string {
  return `<w:p><w:pPr><w:spacing w:before="40" w:after="120"/><w:ind w:left="180"/></w:pPr>${answerRun(value)}</w:p>`;
}

function answerRun(value: string): string {
  return `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="274C3E"/><w:sz w:val="21"/></w:rPr><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
}

function applyModifications(xml: string, modifications: DocxModification[]): string {
  return [...modifications].sort((left, right) => right.start - left.start)
    .reduce((output, modification) =>
      `${output.slice(0, modification.start)}${modification.replacement}${output.slice(modification.end)}`,
    xml);
}

function docxFallbackXml(sourceFileName: string, answers: RenderAnswer[]): string {
  const parts = [
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    directParagraph("Answers not placed in the original", { size: 32, bold: true, color: "2E74B5", after: 160 }),
    directParagraph(`Original document: ${sourceFileName}`, { size: 19, italic: true, color: "61716B", after: 160 }),
    directParagraph("These answers could not be matched to a verified location in the source and are provided explicitly instead.", { size: 20, color: "274C3E", after: 200 })
  ];
  let sectionTitle = "";
  for (const answer of answers) {
    if (answer.sectionTitle !== sectionTitle) {
      sectionTitle = answer.sectionTitle;
      parts.push(directParagraph(sectionTitle, { size: 27, bold: true, color: "2E74B5", before: 220, after: 100, keepNext: true }));
    }
    parts.push(directParagraph(answer.label, { size: 21, bold: true, color: "17352D", before: 80, after: 30, keepNext: true }));
    parts.push(directParagraph(answer.value, { size: 22, color: "273E36", left: 180, after: 120 }));
  }
  return parts.join("");
}

function directParagraph(
  text: string,
  options: {
    size: number;
    color: string;
    bold?: boolean;
    italic?: boolean;
    before?: number;
    after?: number;
    left?: number;
    keepNext?: boolean;
  }
): string {
  const properties = [
    `<w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 0}"/>`,
    options.left ? `<w:ind w:left="${options.left}"/>` : "",
    options.keepNext ? "<w:keepNext/>" : ""
  ].join("");
  const runProperties = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>',
    options.bold ? "<w:b/>" : "",
    options.italic ? "<w:i/>" : "",
    `<w:color w:val="${options.color}"/><w:sz w:val="${options.size}"/>`
  ].join("");
  return `<w:p><w:pPr>${properties}</w:pPr><w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function appendToDocumentXml(documentXml: string, addition: string): string {
  const sectionIndex = documentXml.lastIndexOf("<w:sectPr");
  if (sectionIndex >= 0) return `${documentXml.slice(0, sectionIndex)}${addition}${documentXml.slice(sectionIndex)}`;
  const bodyIndex = documentXml.lastIndexOf("</w:body>");
  if (bodyIndex < 0) throw new DocumentRenderError("The DOCX body could not be updated.");
  return `${documentXml.slice(0, bodyIndex)}${addition}${documentXml.slice(bodyIndex)}`;
}

function appendPdfFallbackPages(
  pdf: PDFDocument,
  sourceFileName: string,
  answers: RenderAnswer[],
  font: PDFFont,
  bold: PDFFont
): void {
  const grouped = new Map<string, RenderAnswer[]>();
  for (const answer of answers) {
    const existing = grouped.get(answer.sectionTitle) ?? [];
    existing.push(answer);
    grouped.set(answer.sectionTitle, existing);
  }
  let page = addFallbackPage(pdf, sourceFileName, font, bold);
  let y = 650;
  for (const [sectionTitle, sectionAnswers] of grouped) {
    if (y < 130) {
      page = addFallbackPage(pdf, sourceFileName, font, bold);
      y = 650;
    }
    page.drawText(sectionTitle, { x: 56, y, size: 15, font: bold, color: rgb(0.18, 0.45, 0.71) });
    y -= 26;
    for (const answer of sectionAnswers) {
      const labelLines = wrapPdfText(answer.label, bold, 10.5, 500);
      const valueLines = wrapPdfText(answer.value, font, 10.5, 480);
      const requiredHeight = (labelLines.length + valueLines.length) * 14 + 18;
      if (y - requiredHeight < 54) {
        page = addFallbackPage(pdf, sourceFileName, font, bold);
        y = 650;
      }
      for (const line of labelLines) {
        page.drawText(line, { x: 56, y, size: 10.5, font: bold, color: rgb(0.09, 0.21, 0.18) });
        y -= 14;
      }
      for (const line of valueLines) {
        page.drawText(line, { x: 72, y, size: 10.5, font, color: rgb(0.15, 0.24, 0.21) });
        y -= 14;
      }
      y -= 12;
    }
    y -= 8;
  }
}

function addFallbackPage(pdf: PDFDocument, sourceFileName: string, font: PDFFont, bold: PDFFont): PDFPage {
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 738, width: 612, height: 54, color: rgb(0.93, 0.96, 0.94) });
  page.drawText("VOCAFORM  |  UNPLACED ANSWERS", {
    x: 56,
    y: 759,
    size: 9,
    font: bold,
    color: rgb(0.26, 0.42, 0.35)
  });
  page.drawText("Answers not placed in the original", {
    x: 56,
    y: 704,
    size: 21,
    font: bold,
    color: rgb(0.09, 0.21, 0.18)
  });
  page.drawText(`Original document: ${sourceFileName}`, {
    x: 56,
    y: 680,
    size: 9,
    font,
    color: rgb(0.38, 0.44, 0.42)
  });
  page.drawLine({ start: { x: 56, y: 42 }, end: { x: 556, y: 42 }, thickness: 0.6, color: rgb(0.79, 0.85, 0.82) });
  page.drawText("This fallback page explicitly accompanies the unchanged source.", {
    x: 56,
    y: 27,
    size: 8,
    font,
    color: rgb(0.38, 0.44, 0.42)
  });
  return page;
}

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line || " ");
  }
  return lines;
}

function canEncodeFallback(font: PDFFont, sourceFileName: string, answers: RenderAnswer[]): boolean {
  try {
    font.encodeText(sourceFileName);
    for (const answer of answers) {
      font.encodeText(answer.sectionTitle);
      font.encodeText(answer.label);
      font.encodeText(answer.value);
    }
    return true;
  } catch {
    return false;
  }
}

function answerPacketResult(
  session: FormSession,
  bytes: Buffer,
  status: "draft" | "verified" | "fallback",
  source: SourceDocument | null,
  placements: RenderPlacement[],
  answers: RenderAnswer[]
): RenderedDocument {
  const effectivePlacements = placements.length > 0 ? placements : answers.map((answer) => ({
    fieldId: answer.fieldId,
    targetKind: "answer_packet" as const,
    locator: answer.fieldId,
    result: "fallback" as const,
    detail: "Included in the section-matched answer packet."
  }));
  return renderedResult(
    session,
    bytes,
    answerPacketContentType(),
    `${safeFileName(session.form.id)}-${status === "draft" ? "draft" : "verified-answer-packet"}.docx`,
    "answer_packet",
    source,
    effectivePlacements
  );
}

function renderedResult(
  session: FormSession,
  bytes: Buffer,
  contentType: string,
  fileName: string,
  kind: RenderedDocumentKind,
  source: SourceDocument | null,
  placements: RenderPlacement[]
): RenderedDocument {
  const answerCount = renderAnswers(session).length;
  const placedCount = placements.filter((placement) => placement.result === "placed").length;
  const fallbackCount = placements.filter((placement) => placement.result === "fallback").length;
  const covered = placedCount + fallbackCount;
  return {
    bytes,
    contentType,
    fileName,
    kind,
    report: {
      kind,
      sourceFileName: source?.fileName ?? session.form.source.fileName,
      sourceSha256: source ? sha256(source.bytes) : null,
      outputSha256: sha256(bytes),
      sourcePreserved: source ? true : false,
      answerCount,
      placedCount,
      fallbackCount,
      coveragePercent: answerCount === 0 ? 100 : Math.round(covered / answerCount * 100),
      completionSummaryInserted: false,
      placements
    }
  };
}

function hasRenderTarget(session: FormSession, kind: RenderTarget["kind"]): boolean {
  return session.form.sections.some((section) =>
    section.fields.some((field) => field.renderTargets.some((target) => target.kind === kind))
  );
}

function completedFileName(fileName: string, extension: "docx" | "pdf"): string {
  const parsed = path.parse(fileName);
  return `${safeFileName(parsed.name)}-completed.${extension}`;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "vocaform";
}

function requireDocx(bytes: Buffer): void {
  if (!bytes.subarray(0, 2).equals(Buffer.from("PK"))) {
    throw new DocumentRenderError("The retained Word source is not a valid DOCX package.");
  }
}

function requirePdf(bytes: Buffer): void {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new DocumentRenderError("The retained PDF source is not a valid PDF.");
  }
}

function assertSourcePreserved(source: Buffer, snapshot: Buffer): void {
  if (!source.equals(snapshot)) {
    throw new DocumentRenderError("The original source changed while the completed document was being rendered.");
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeComparable(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "ja"].includes(normalized)) return "yes";
  if (["false", "no", "n", "nee"].includes(normalized)) return "no";
  return normalized;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown PDF error";
}
