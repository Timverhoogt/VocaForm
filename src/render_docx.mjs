import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readZip, writeZip } from "./docx_package.mjs";
import { insertAfterMatchedParagraphs } from "./docx_text.mjs";
import { getAllInterviewFields, loadJson } from "./form_state.mjs";

function parseArgs(argv) {
  const named = new Map();
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      named.set(item, argv[index + 1]);
      index += 1;
    } else {
      positional.push(item);
    }
  }

  return { named, positional };
}

const args = parseArgs(process.argv.slice(2));

function getArg(name, positionalIndex, fallback = null) {
  return args.named.get(name) || args.positional[positionalIndex] || fallback;
}

function requireArg(name, positionalIndex) {
  const value = getArg(name, positionalIndex);
  if (!value) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return value;
}

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

function buildAppendixXml(schema, state, { title = "Ingevulde antwoorden", includeProfile = true } = {}) {
  const parts = [];
  const isDemo = state.metadata?.demo === true;

  parts.push(paragraph(title, { bold: true }));
  if (isDemo) {
    parts.push(paragraph("DEMO: deze antwoorden zijn automatisch gegenereerd om de renderer te testen.", { italic: true }));
  }
  parts.push(paragraph(`Formulier: ${schema.title || schema.form_id}`));

  const profileAnswers = state.profile_answers || {};
  if (includeProfile && Object.keys(profileAnswers).length) {
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
    const hasAnyAnswer = sectionFields.some((field) => state.interview_answers?.[field.id]);
    if (!hasAnyAnswer) continue;

    parts.push(paragraph(section.title, { bold: true }));
    for (const field of sectionFields) {
      const answer = state.interview_answers?.[field.id];
      parts.push(paragraph(field.label, { bold: true }));
      parts.push(paragraph(formatAnswer(answer)));
    }
  }

  return parts.join("");
}

function getRenderableFields(schema, state) {
  return getAllInterviewFields(schema).filter((field) => {
    const answer = state.interview_answers?.[field.id];
    return answer && answer.status !== "unanswered";
  });
}

function buildInPlaceInsertions(schema, state) {
  return getRenderableFields(schema, state).map((field) => ({
    id: field.id,
    anchor: field.render_anchor || field.label,
    xml: paragraph(`Antwoord: ${formatAnswer(state.interview_answers[field.id])}`, { italic: true })
  }));
}

function schemaWithOnlyFields(schema, fieldIds) {
  return {
    ...schema,
    profile_fields: [],
    sections: schema.sections
      .map((section) => ({
        ...section,
        fields: section.fields.filter((field) => fieldIds.has(field.id))
      }))
      .filter((section) => section.fields.length > 0)
  };
}

function appendToDocumentXml(documentXml, appendixXml) {
  const sectPrIndex = documentXml.lastIndexOf("<w:sectPr");
  if (sectPrIndex !== -1) {
    return `${documentXml.slice(0, sectPrIndex)}${appendixXml}${documentXml.slice(sectPrIndex)}`;
  }

  const bodyCloseIndex = documentXml.lastIndexOf("</w:body>");
  if (bodyCloseIndex === -1) {
    throw new Error("Could not find </w:body> in word/document.xml.");
  }
  return `${documentXml.slice(0, bodyCloseIndex)}${appendixXml}${documentXml.slice(bodyCloseIndex)}`;
}

const templatePath = requireArg("--template", 0);
const schemaPath = requireArg("--schema", 1);
const statePath = requireArg("--state", 2);
const outPath = requireArg("--out", 3);
const mode = getArg("--mode", 4, "append");

const [templateBuffer, schema, state] = await Promise.all([
  readFile(templatePath),
  loadJson(schemaPath),
  loadJson(statePath)
]);

if (state.form_id && state.form_id !== schema.form_id) {
  throw new Error(`State form_id ${state.form_id} does not match schema form_id ${schema.form_id}.`);
}

const entries = readZip(templateBuffer);
const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
if (!documentEntry) {
  throw new Error("DOCX did not contain word/document.xml.");
}

const documentXml = documentEntry.data.toString("utf8");
let updatedDocumentXml;
let report;

if (mode === "append") {
  updatedDocumentXml = appendToDocumentXml(documentXml, buildAppendixXml(schema, state));
  report = { mode, placed: 0, unmatched: 0 };
} else if (mode === "in-place") {
  const result = insertAfterMatchedParagraphs(documentXml, buildInPlaceInsertions(schema, state));
  updatedDocumentXml = result.documentXml;

  if (result.unmatched.length) {
    const unmatchedIds = new Set(result.unmatched.map((item) => item.id));
    updatedDocumentXml = appendToDocumentXml(
      updatedDocumentXml,
      buildAppendixXml(schemaWithOnlyFields(schema, unmatchedIds), state, {
        title: "Niet geplaatste antwoorden",
        includeProfile: false
      })
    );
  }

  report = { mode, placed: result.placed.length, unmatched: result.unmatched.length };
} else {
  throw new Error(`Unsupported render mode: ${mode}. Use append or in-place.`);
}

documentEntry.data = Buffer.from(updatedDocumentXml, "utf8");

await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
await writeFile(outPath, writeZip(entries));
console.log(`Wrote DOCX: ${path.resolve(outPath)}`);
console.log(`Render report: ${JSON.stringify(report)}`);
