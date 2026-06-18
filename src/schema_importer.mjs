import path from "node:path";
import { normalizeText } from "./docx_text.mjs";

export function parseArgs(argv) {
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

export function getArg(args, name, positionalIndex, fallback = null) {
  return args.named.get(name) || args.positional[positionalIndex] || fallback;
}

export function requireArg(args, name, positionalIndex) {
  const value = getArg(args, name, positionalIndex);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
}

export function slugify(value) {
  const base = normalizeText(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return base || "field";
}

export function uniqueSlug(base, seen) {
  let candidate = base;
  let suffix = 2;
  while (seen.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}

function isLikelyQuestion(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === ".") return false;
  if (trimmed.includes("?")) return true;
  if (trimmed.endsWith(":")) return true;
  if (trimmed.length > 65 && /[a-z]/i.test(trimmed)) return true;
  return false;
}

function isLikelySectionHeading(items, index) {
  const text = items[index]?.text.trim() || "";
  const next = items[index + 1]?.text.trim() || "";

  if (!text || text === ".") return false;
  if (text.length > 70) return false;
  if (/[?:;]/.test(text)) return false;
  if (/\d/.test(text)) return false;
  if (text.endsWith(".")) return false;
  if (text.toLowerCase().includes("formulier")) return false;
  if (!next) return false;

  return isLikelyQuestion(next) && (next.includes("?") || next.length > 65);
}

function makeField(text, sectionId, seen) {
  const label = text.trim();
  const id = uniqueSlug(`${sectionId}_${slugify(label)}`, seen);
  return {
    id,
    label,
    render_anchor: label,
    type: label.length < 45 ? "short_text" : "long_text",
    required: false,
    interview_prompt: label,
    examples: []
  };
}

export function textToParagraphs(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line, index) => ({
      index,
      text: line.trim()
    }))
    .filter((paragraph) => paragraph.text);
}

export function importSchema({ filename, format, paragraphs, notes = [] }) {
  const items = paragraphs
    .map((paragraph) => ({ ...paragraph, text: paragraph.text.trim() }))
    .filter((paragraph) => paragraph.text);

  const title = items[0]?.text || path.basename(filename, path.extname(filename));
  const headingIndexes = new Set();
  for (let index = 0; index < items.length; index += 1) {
    if (isLikelySectionHeading(items, index)) headingIndexes.add(index);
  }

  const firstHeadingIndex = [...headingIndexes][0] ?? 0;
  const sections = [];
  const seenIds = new Set();
  let currentSection = null;

  for (let index = firstHeadingIndex; index < items.length; index += 1) {
    const item = items[index];
    if (headingIndexes.has(index)) {
      const sectionId = uniqueSlug(slugify(item.text), seenIds);
      currentSection = {
        id: sectionId,
        title: item.text,
        fields: []
      };
      sections.push(currentSection);
      continue;
    }

    if (!currentSection || !isLikelyQuestion(item.text)) continue;
    currentSection.fields.push(makeField(item.text, currentSection.id, seenIds));
  }

  return {
    form_id: uniqueSlug(slugify(path.basename(filename, path.extname(filename))), new Set()),
    version: "draft-import",
    title,
    language: "unknown",
    import_notes: [
      `Draft schema generated from ${format} text.`,
      "Review field grouping, required flags, profile fields, and interview prompts before production use.",
      ...notes
    ],
    source: {
      filename: path.basename(filename),
      format
    },
    profile_fields: [],
    sections
  };
}

export function summarizeImport(schema) {
  return {
    sections: schema.sections.length,
    fields: schema.sections.reduce((total, section) => total + section.fields.length, 0)
  };
}

