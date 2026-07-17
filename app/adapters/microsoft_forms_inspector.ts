import type { Page } from "@playwright/test";
import {
  finalizeWebFormInspection,
  type RawWebFormInspection,
  type WebFormInspection,
  type WebFormInspectionSource,
  type WebFormQuestionType
} from "./web_form_inspection";

export async function inspectMicrosoftFormsPage(
  page: Page,
  source: WebFormInspectionSource | null = null
): Promise<WebFormInspection> {
  await page.evaluate("globalThis.__name ??= (value) => value");
  const raw = await page.evaluate<RawWebFormInspection>(() => {
    const text = (value: string | null | undefined): string => value?.replace(/\s+/g, " ").trim() ?? "";
    const unique = (values: string[]): string[] => [...new Set(values.map(text).filter(Boolean))];
    const inferType = (element: Element): WebFormQuestionType => {
      const automation = [...element.querySelectorAll("[data-automation-id]")]
        .map((node) => node.getAttribute("data-automation-id")?.toLowerCase() ?? "")
        .join(" ");
      const aria = [...element.querySelectorAll("[aria-label]")]
        .map((node) => node.getAttribute("aria-label")?.toLowerCase() ?? "")
        .join(" ");
      if (/file.?upload/.test(automation) || element.querySelector("input[type=file]")) return "file_upload";
      if (/ranking/.test(automation)) return "ranking";
      if (/rating|netpromoter|nps/.test(automation)) return "rating";
      if (/likert|matrix/.test(automation) || element.querySelector('[role="grid"]')) return "matrix";
      if (/date/.test(automation) || /date picker/.test(aria) || element.querySelector("input[type=date]")) return "date";
      if (/time/.test(automation) || element.querySelector("input[type=time]")) return "time";
      if (/multiline|long.?answer/.test(automation) || element.querySelector("textarea")) return "long_text";
      const input = element.querySelector<HTMLInputElement>("input:not([type=hidden])");
      if (input?.type === "email") return "email";
      if (input?.type === "tel") return "phone";
      if (input?.type === "number") return "number";
      if (element.querySelectorAll('[role="radiogroup"]').length > 1) return "matrix";
      if (element.querySelector('[role="checkbox"], input[type=checkbox]')) return "multi_choice";
      if (element.querySelector('[role="radio"], input[type=radio], [role="listbox"], [role="option"], select')) {
        return "single_choice";
      }
      if (/textinput|textinputcontainer|singleline/.test(automation) || input) return "short_text";
      return "unknown";
    };
    const providerId = (element: Element): string | null => {
      const identified = element.querySelector<HTMLElement>('[id^="QuestionId_"]');
      if (identified?.id) return identified.id.slice("QuestionId_".length);
      const ownId = element.getAttribute("data-question-id") ?? element.id;
      return text(ownId) || null;
    };
    const options = (element: Element): string[] => {
      const nodes = element.querySelectorAll(
        '[role="radio"], [role="checkbox"], [role="option"], option, [data-automation-id="rankingOption"]'
      );
      return unique([...nodes].flatMap((option) => {
        const value = option.getAttribute("data-value")
          ?? option.getAttribute("aria-label")
          ?? option.textContent;
        return value ? [value] : [];
      }));
    };

    const sections: string[] = [];
    let currentSection: string | null = null;
    const questions: RawWebFormInspection["questions"] = [];
    const nodes = [...document.querySelectorAll('[data-automation-id="questionItem"]')];
    for (const element of nodes) {
      const section = text(element.querySelector('[data-automation-id="sectionTitle"]')?.textContent);
      if (section) {
        currentSection = section;
        sections.push(section);
      }
      const titleContainer = element.querySelector('[data-automation-id="questionTitle"]');
      const heading = titleContainer?.querySelector('[role="heading"]')
        ?? titleContainer
        ?? element.querySelector('[id^="QuestionId_"] [role="heading"]');
      const label = text(heading?.textContent);
      if (!heading) continue;
      const id = providerId(element);
      const description = text(element.querySelector('[data-automation-id="questionDescription"]')?.textContent);
      questions.push({
        providerFieldId: id,
        label,
        description: description || null,
        type: inferType(element),
        required: Boolean(element.querySelector('[data-automation-id="requiredStar"], [aria-required="true"]')),
        options: options(element),
        sectionTitle: currentSection,
        locatorCandidates: [
          ...(id ? [{ kind: "provider_id" as const, value: id, stability: "high" as const }] : []),
          ...(label ? [{ kind: "accessible_label" as const, value: label, stability: "medium" as const }] : [])
        ]
      });
    }

    const title = text(document.querySelector('[data-automation-id="formTitle"]')?.textContent) || text(document.title);
    const description = text(document.querySelector('[data-automation-id="formSubTitle"]')?.textContent);
    const hasNextPage = Boolean(document.querySelector('[data-automation-id="nextButton"]'));
    const warnings: string[] = [];
    const outOfScopeReasons: string[] = [];
    if (!document.querySelector('[data-automation-id="questionItem"]')) {
      warnings.push("The rendered page did not expose the expected Microsoft Forms question boundary.");
    }
    if (questions.some((question) => !question.providerFieldId)) {
      warnings.push("Some questions did not expose a Microsoft QuestionId identifier.");
    }
    if (document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, [data-sitekey]')) {
      outOfScopeReasons.push("CAPTCHA-protected forms are out of scope for the public web-form interview.");
    }
    if (document.querySelector('[data-automation-id*="quiz" i], [data-is-quiz="true"]')) {
      outOfScopeReasons.push("Quizzes are out of scope because scoring rules cannot be treated as ordinary form questions.");
    }

    return {
      provider: "microsoft_forms",
      title,
      locale: document.documentElement.lang || null,
      description: description || null,
      sections: unique(sections),
      questions,
      hasNextPage,
      providerSignals: {
        markupBoundaryFound: Boolean(document.querySelector(
          '[data-automation-id="formTitle"], [data-automation-id="questionItem"]'
        )),
        questionBoundaryFound: nodes.length > 0 && questions.length > 0,
        nextControlFound: hasNextPage,
        submitControlFound: Boolean(document.querySelector(
          '[data-automation-id="submitButton"], button[type="submit"], input[type="submit"]'
        ))
      },
      warnings,
      outOfScopeReasons
    };
  });
  await page.evaluate("delete globalThis.__name");

  return finalizeWebFormInspection(raw, source);
}
