import type { Page } from "@playwright/test";
import {
  finalizeWebFormInspection,
  type RawWebFormInspection,
  type WebFormInspection,
  type WebFormInspectionSource,
  type WebFormQuestionType
} from "./web_form_inspection";

export async function inspectGoogleFormsPage(
  page: Page,
  source: WebFormInspectionSource | null = null
): Promise<WebFormInspection> {
  // tsx preserves local function names with a small helper. Playwright serializes
  // this callback without that module helper, so expose an identity equivalent
  // only for the duration of the read-only DOM extraction.
  await page.evaluate("globalThis.__name ??= (value) => value");
  const raw = await page.evaluate<RawWebFormInspection>(() => {
    const text = (value: string | null | undefined): string => value?.replace(/\s+/g, " ").trim() ?? "";
    const unique = (values: string[]): string[] => [...new Set(values.map(text).filter(Boolean))];
    const visibleText = (element: Element | null): string => {
      if (!element) return "";
      const clone = element.cloneNode(true) as Element;
      for (const marker of clone.querySelectorAll("span")) {
        if (text(marker.textContent) === "*") marker.remove();
      }
      return text(clone.textContent);
    };
    const parseParams = (element: Element): unknown[] | null => {
      const owner = element.matches("[data-params]") ? element : element.querySelector("[data-params]");
      const encoded = owner?.getAttribute("data-params") ?? "";
      if (!encoded.startsWith("%.@.")) return null;
      const payload = encoded.slice(4);
      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let index = 0; index < payload.length; index += 1) {
        const character = payload[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\" && inString) {
          escaped = true;
          continue;
        }
        if (character === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (character === "[") depth += 1;
        if (character === "]") {
          depth -= 1;
          if (depth === 0) {
            end = index + 1;
            break;
          }
        }
      }
      if (end < 0) return null;
      try {
        const parsed: unknown = JSON.parse(payload.slice(0, end));
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    };
    const nested = (value: unknown, ...indexes: number[]): unknown => {
      let current = value;
      for (const index of indexes) {
        if (!Array.isArray(current)) return null;
        current = current[index];
      }
      return current;
    };
    const metadataOptions = (params: unknown[] | null): string[] => {
      const rows = nested(params, 4, 0, 1);
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((row) => {
        if (typeof row === "string") return [row];
        if (Array.isArray(row) && typeof row[0] === "string") return [row[0]];
        return [];
      });
    };
    const typeFromCode = (code: unknown): WebFormQuestionType | null => {
      const types: Record<number, WebFormQuestionType> = {
        0: "short_text",
        1: "long_text",
        2: "single_choice",
        3: "single_choice",
        4: "multi_choice",
        5: "scale",
        7: "matrix",
        8: "matrix",
        9: "date",
        10: "time",
        13: "file_upload"
      };
      return typeof code === "number" ? types[code] ?? null : null;
    };
    const inferType = (element: Element, params: unknown[] | null): WebFormQuestionType => {
      const coded = typeFromCode(params?.[3]);
      if (coded) return coded;
      const input = element.querySelector<HTMLInputElement>("input:not([type=hidden])");
      if (element.querySelector("input[type=file]")) return "file_upload";
      if (element.querySelector("textarea")) return "long_text";
      if (input?.type === "email") return "email";
      if (input?.type === "tel") return "phone";
      if (input?.type === "number") return "number";
      if (input?.type === "date" || /date picker/i.test(input?.getAttribute("aria-label") ?? "")) return "date";
      if (input?.type === "time" || /time/i.test(input?.getAttribute("aria-label") ?? "")) return "time";
      if (element.querySelectorAll('[role="radiogroup"]').length > 1 || element.querySelector('[role="grid"]')) {
        return "matrix";
      }
      if (element.querySelector('[role="checkbox"], input[type=checkbox]')) return "multi_choice";
      if (element.querySelector('[role="radio"], input[type=radio], [role="listbox"], select')) {
        return "single_choice";
      }
      if (input) return "short_text";
      return "unknown";
    };
    const fieldId = (element: Element, params: unknown[] | null): string | null => {
      const named = element.querySelector<HTMLInputElement>(
        'input[name^="entry."], textarea[name^="entry."], select[name^="entry."]'
      )?.name;
      if (named) return named.replace(/_sentinel$/, "");
      const entryId = nested(params, 4, 0, 0);
      if (typeof entryId === "number" || typeof entryId === "string") return `entry.${String(entryId)}`;
      const itemId = params?.[0];
      if (typeof itemId === "number" || typeof itemId === "string") return `item.${String(itemId)}`;
      return null;
    };
    const controlOptions = (element: Element): string[] => {
      const selectors = [
        '[role="radio"]',
        '[role="checkbox"]',
        '[role="option"]',
        "option",
        "[data-answer-value]",
        "[data-value]"
      ];
      return [...element.querySelectorAll(selectors.join(","))].flatMap((option) => {
        const value = option.getAttribute("data-answer-value")
          ?? option.getAttribute("data-value")
          ?? option.getAttribute("aria-label")
          ?? option.textContent;
        return value ? [value] : [];
      });
    };

    const questions: RawWebFormInspection["questions"] = [];
    const sections: string[] = [];
    let currentSection: string | null = null;
    const items = [...document.querySelectorAll('[role="listitem"]')].filter((item) => {
      const parentItem = item.parentElement?.closest('[role="listitem"]');
      return !parentItem;
    });

    for (const item of items) {
      const sectionHeading = item.querySelector('[role="heading"][aria-level="2"]');
      const questionHeading = item.querySelector('[role="heading"][aria-level="3"]');
      if (sectionHeading && !questionHeading) {
        currentSection = visibleText(sectionHeading) || null;
        if (currentSection) sections.push(currentSection);
        continue;
      }
      if (!questionHeading) continue;

      const label = visibleText(questionHeading);
      const params = parseParams(item);
      const providerFieldId = fieldId(item, params);
      const options = unique([...controlOptions(item), ...metadataOptions(params)]);
      const descriptionFromMetadata = params?.[2];
      const description = typeof descriptionFromMetadata === "string" ? text(descriptionFromMetadata) : "";
      const required = [...item.querySelectorAll("span")].some((marker) => text(marker.textContent) === "*")
        || Boolean(item.querySelector('[aria-required="true"], [data-required="true"]'));

      questions.push({
        providerFieldId,
        label,
        description: description || null,
        type: inferType(item, params),
        required,
        options,
        sectionTitle: currentSection,
        locatorCandidates: [
          ...(providerFieldId ? [{ kind: "provider_id" as const, value: providerFieldId, stability: "medium" as const }] : []),
          ...(label ? [{ kind: "accessible_label" as const, value: label, stability: "medium" as const }] : [])
        ]
      });
    }

    const title = visibleText(document.querySelector('[role="heading"][aria-level="1"]')) || text(document.title);
    const description = text(
      document.querySelector('[role="heading"][aria-level="1"]')?.parentElement?.querySelector("div:nth-of-type(2)")?.textContent
    );
    const hasNextPage = Boolean(
      document.querySelector('[jsname="OCpkoe"], [data-navigation="next"], [aria-label="Next"]')
    );
    const warnings: string[] = [];
    const outOfScopeReasons: string[] = [];
    if (!document.querySelector('form[action*="formResponse"]')) {
      warnings.push("The rendered page did not expose the expected Google Forms response boundary.");
    }
    if (questions.some((question) => !question.providerFieldId)) {
      warnings.push("Some questions did not expose a Google entry or item identifier.");
    }
    if (document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, [data-sitekey]')) {
      outOfScopeReasons.push("CAPTCHA-protected forms are out of scope for the public web-form interview.");
    }
    if (document.querySelector('[data-quiz="true"], [data-is-quiz="true"]')) {
      outOfScopeReasons.push("Quizzes are out of scope because scoring rules cannot be treated as ordinary form questions.");
    }

    return {
      provider: "google_forms",
      title,
      locale: document.documentElement.lang || null,
      description: description || null,
      sections: unique(sections),
      questions,
      hasNextPage,
      providerSignals: {
        markupBoundaryFound: Boolean(document.querySelector('form[action*="formResponse"]')),
        questionBoundaryFound: items.length > 0 && questions.length > 0,
        nextControlFound: hasNextPage,
        submitControlFound: Boolean(document.querySelector(
          '[role="button"][jsname="M2UYVd"], button[type="submit"], input[type="submit"]'
        ))
      },
      warnings,
      outOfScopeReasons
    };
  });
  await page.evaluate("delete globalThis.__name");

  return finalizeWebFormInspection(raw, source);
}
