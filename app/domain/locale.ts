export const UNKNOWN_LOCALE = "und";

export function canonicalizeLocale(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

export function normalizeLocale(value: string, fallback = UNKNOWN_LOCALE): string {
  return canonicalizeLocale(value) ?? fallback;
}

export function realtimeTranscriptionLanguage(locale: string): string | null {
  const canonical = canonicalizeLocale(locale);
  if (!canonical) return null;
  const language = canonical.split("-")[0]?.toLowerCase() ?? "";
  return /^[a-z]{2}$/.test(language) ? language : null;
}
