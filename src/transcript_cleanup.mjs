const transcriptArtifactReplacements = [
  [/\bgeefsvoorbeelden\b/giu, "geef wat voorbeelden"],
  [/\bgeefwatvoorbeelden\b/giu, "geef wat voorbeelden"],
  [/\bgeefeensvoorbeelden\b/giu, "geef eens voorbeelden"],
  [/\bgeefvoorbeelden\b/giu, "geef voorbeelden"],
  [/\bherhaaldevraag\b/giu, "herhaal de vraag"],
  [/\bherhaaldvraag\b/giu, "herhaal de vraag"],
  [/\bwatbedoelje\b/giu, "wat bedoel je"],
  [/\bkunjevoorbeeldengeven\b/giu, "kun je voorbeelden geven"],
  [/\bnoemvoorbeelden\b/giu, "noem voorbeelden"]
];

function cleanTranscriptLine(line) {
  let text = String(line || "").trim().replace(/\s+/g, " ");
  for (const [pattern, replacement] of transcriptArtifactReplacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function cleanTranscriptText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(cleanTranscriptLine)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeForIntent(value) {
  return cleanTranscriptText(value)
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

export function isInterviewControlOnly(value) {
  const text = normalizeForIntent(value);
  return [
    "geef voorbeelden",
    "geef wat voorbeelden",
    "geef eens voorbeelden",
    "kun je voorbeelden geven",
    "noem voorbeelden",
    "herhaal de vraag",
    "herhaal vraag",
    "wat bedoel je"
  ].includes(text);
}

export function buildInterviewControlReply(value, field) {
  const text = normalizeForIntent(value);
  const question = field?.interview_prompt || "Vertel wat je hierover wilt invullen.";

  if (text.includes("voorbeeld")) {
    const examples = field?.examples?.length
      ? ` Bijvoorbeeld: ${field.examples.slice(0, 3).join("; ")}.`
      : " Denk aan concrete situaties, gewoontes, uitzonderingen of dingen die belangrijk zijn voor het formulier.";
    return `${question}${examples}`;
  }

  if (text.includes("herhaal") || text.includes("bedoel")) {
    return question;
  }

  return question;
}
