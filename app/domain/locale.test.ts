import { describe, expect, it } from "vitest";
import {
  canonicalizeLocale,
  normalizeLocale,
  realtimeTranscriptionLanguage
} from "./locale";
import { localeSchema } from "./schemas";

describe("international locale handling", () => {
  it("canonicalizes valid BCP 47 language tags", () => {
    expect(canonicalizeLocale("nl-nl")).toBe("nl-NL");
    expect(canonicalizeLocale("zh-hant-tw")).toBe("zh-Hant-TW");
    expect(localeSchema.parse("en-us")).toBe("en-US");
  });

  it("rejects invalid canonical form locales and uses und at model boundaries", () => {
    expect(canonicalizeLocale("not_a_locale")).toBeNull();
    expect(() => localeSchema.parse("not_a_locale")).toThrow();
    expect(normalizeLocale("not_a_locale")).toBe("und");
  });

  it("provides Realtime only with supported two-letter transcription hints", () => {
    expect(realtimeTranscriptionLanguage("en-US")).toBe("en");
    expect(realtimeTranscriptionLanguage("nl-NL")).toBe("nl");
    expect(realtimeTranscriptionLanguage("fil-PH")).toBeNull();
    expect(realtimeTranscriptionLanguage("und")).toBeNull();
  });
});
