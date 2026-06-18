import { writeZip } from "./docx_package.mjs";
import { getAllInterviewFields } from "./form_state.mjs";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paragraph(text, { bold = false, italic = false } = {}) {
  const runProps = bold || italic
    ? `<w:rPr>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}</w:rPr>`
    : "";
  return `<w:p><w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function formatProfileValue(value) {
  if (value === null || value === undefined) return "Niet ingevuld";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(formatProfileValue).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    if (value.full_name) return value.full_name;
    const parts = [];
    if (value.name) parts.push(value.name);
    if (value.phone) parts.push(value.phone);
    if (parts.length) return parts.join(" - ");
    return Object.entries(value)
      .map(([key, nestedValue]) => `${key}: ${formatProfileValue(nestedValue)}`)
      .join("; ");
  }
  return String(value);
}

function formatAnswer(answer) {
  if (!answer) return "Nog niet ingevuld.";
  if (answer.status === "skipped") return "Overgeslagen.";
  if (answer.status === "needs_followup") {
    const base = answer.normalized_answer || answer.raw_answer || "Nog onvoldoende ingevuld.";
    return answer.follow_up_question ? `${base} Vervolgvraag: ${answer.follow_up_question}` : base;
  }
  return answer.normalized_answer || answer.raw_answer || "Nog niet ingevuld.";
}

function buildBodyXml(schema, state, { title = "Ingevulde antwoorden" } = {}) {
  const parts = [];
  const isDemo = state.metadata?.demo === true;

  parts.push(paragraph(title, { bold: true }));
  if (isDemo) {
    parts.push(paragraph("DEMO: deze antwoorden zijn automatisch gegenereerd om de renderer te testen.", { italic: true }));
  }
  parts.push(paragraph(`Formulier: ${schema.title || schema.form_id}`));
  if (schema.source?.filename) {
    parts.push(paragraph(`Bron: ${schema.source.filename} (${schema.source.format || "onbekend"})`));
  }

  const profileAnswers = state.profile_answers || {};
  if (Object.keys(profileAnswers).length) {
    parts.push(paragraph("Profielgegevens", { bold: true }));
    for (const field of schema.profile_fields || []) {
      const answer = profileAnswers[field.id];
      if (answer?.status === "prefilled") {
        parts.push(paragraph(`${field.label}: ${formatProfileValue(answer.value)}`));
      }
    }
  }

  for (const section of schema.sections || []) {
    const sectionFields = getAllInterviewFields({ ...schema, sections: [section] });
    if (!sectionFields.length) continue;
    parts.push(paragraph(section.title, { bold: true }));
    for (const field of sectionFields) {
      const answer = state.interview_answers?.[field.id];
      parts.push(paragraph(field.label, { bold: true }));
      parts.push(paragraph(formatAnswer(answer)));
    }
  }

  return parts.join("");
}

export function buildReportDocx(schema, state, options = {}) {
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    buildBodyXml(schema, state, options),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
    "</w:body>",
    "</w:document>"
  ].join("");

  return writeZip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        "</Types>"
      ].join(""), "utf8")
    },
    {
      name: "_rels/.rels",
      data: Buffer.from([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        "</Relationships>"
      ].join(""), "utf8")
    },
    {
      name: "word/document.xml",
      data: Buffer.from(documentXml, "utf8")
    }
  ]);
}
