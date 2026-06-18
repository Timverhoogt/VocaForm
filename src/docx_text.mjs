export function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

export function paragraphText(paragraphXml) {
  return [...paragraphXml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

export function normalizeText(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function extractParagraphs(documentXml) {
  return [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match, index) => ({
    index,
    start: match.index,
    end: match.index + match[0].length,
    xml: match[0],
    text: paragraphText(match[0])
  }));
}

export function findAnchorMatches(documentXml, anchors) {
  const paragraphs = extractParagraphs(documentXml);

  return anchors.map((anchor) => {
    const normalizedAnchor = normalizeText(anchor.text);
    const matches = normalizedAnchor
      ? paragraphs.filter((paragraph) => normalizeText(paragraph.text).includes(normalizedAnchor))
      : [];

    return {
      ...anchor,
      matches: matches.map((paragraph) => ({
        paragraph_index: paragraph.index,
        paragraph_text: paragraph.text.trim()
      }))
    };
  });
}

export function insertAfterMatchedParagraphs(documentXml, insertions) {
  const paragraphs = extractParagraphs(documentXml);
  const groupedInsertions = new Map();
  const placed = [];
  const unmatched = [];

  for (const insertion of insertions) {
    const normalizedAnchor = normalizeText(insertion.anchor);
    const paragraph = paragraphs.find((candidate) => normalizeText(candidate.text).includes(normalizedAnchor));

    if (!paragraph) {
      unmatched.push(insertion);
      continue;
    }

    if (!groupedInsertions.has(paragraph.index)) groupedInsertions.set(paragraph.index, []);
    groupedInsertions.get(paragraph.index).push(insertion.xml);
    placed.push({
      id: insertion.id,
      anchor: insertion.anchor,
      paragraph_index: paragraph.index,
      paragraph_text: paragraph.text.trim()
    });
  }

  let output = "";
  let cursor = 0;
  for (const paragraph of paragraphs) {
    output += documentXml.slice(cursor, paragraph.end);
    const additions = groupedInsertions.get(paragraph.index);
    if (additions) output += additions.join("");
    cursor = paragraph.end;
  }
  output += documentXml.slice(cursor);

  return {
    documentXml: output,
    placed,
    unmatched: unmatched.map(({ id, anchor }) => ({ id, anchor }))
  };
}

