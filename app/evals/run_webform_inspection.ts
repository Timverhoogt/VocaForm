import { chromium } from "@playwright/test";
import { inspectRemoteWebForm, inspectWebFormPage } from "../adapters/web_form_browser";
import type { WebFormInspection } from "../adapters/web_form_inspection";
import { WEB_FORM_SPIKE_FIXTURES, type WebFormSpikeFixture } from "./web_form_spike_fixtures";

const args = process.argv.slice(2);
const suppliedUrl = args.find((argument) => /^https:\/\//i.test(argument)) ?? null;

if (args.includes("--help")) {
  console.log("Usage: npm run eval:webforms | npm run inspect:webform -- <public responder URL>");
} else if (suppliedUrl) {
  const inspection = await inspectRemoteWebForm(suppliedUrl);
  console.log(JSON.stringify(inspection, null, 2));
} else if (args.length > 0) {
  throw new Error("Provide a public HTTPS Google Forms or Microsoft Forms responder URL.");
} else {
  const results = await evaluateFixtures();
  console.log(JSON.stringify({ passed: true, fixtures: results }, null, 2));
}

async function evaluateFixtures(): Promise<Array<Record<string, unknown>>> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      javaScriptEnabled: true,
      serviceWorkers: "block"
    });
    try {
      const results: Array<Record<string, unknown>> = [];
      for (const fixture of WEB_FORM_SPIKE_FIXTURES) {
        const page = await context.newPage();
        try {
          await page.setContent(fixture.html, { waitUntil: "domcontentloaded" });
          const inspection = await inspectWebFormPage(page, fixture.provider);
          validateFixture(fixture, inspection);
          results.push({
            name: fixture.name,
            provider: fixture.provider,
            metrics: inspection.metrics,
            currentPageOnly: inspection.capabilities.currentPageOnly
          });
        } finally {
          await page.close();
        }
      }
      return results;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

function validateFixture(fixture: WebFormSpikeFixture, inspection: WebFormInspection): void {
  assertEqual(inspection.metrics.questionCount, fixture.expectedQuestionCount, `${fixture.name}: question count`);
  assertEqual(inspection.metrics.labelCoveragePercent, 100, `${fixture.name}: label coverage`);
  assertEqual(inspection.metrics.recognizedTypeCoveragePercent, 100, `${fixture.name}: type coverage`);
  assertEqual(inspection.metrics.providerIdCoveragePercent, 100, `${fixture.name}: provider ID coverage`);
  assertEqual(inspection.metrics.usableLocatorCoveragePercent, 100, `${fixture.name}: locator coverage`);
  assertEqual(inspection.capabilities.readOnly, true, `${fixture.name}: read-only capability`);
  assertEqual(inspection.capabilities.submissionBlocked, true, `${fixture.name}: submission block`);
  assertEqual(inspection.capabilities.questionValuesRead, false, `${fixture.name}: value-reading capability`);
  assertEqual(inspection.capabilities.currentPageOnly, true, `${fixture.name}: pagination detection`);
  for (const [type, expected] of Object.entries(fixture.expectedTypes)) {
    assertEqual(inspection.metrics.typeCounts[type as keyof typeof inspection.metrics.typeCounts], expected, `${fixture.name}: ${type}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
}
