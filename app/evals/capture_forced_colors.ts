import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.VOCAFORM_REVIEW_URL?.trim() || "http://127.0.0.1:5173";
const outputDirectory = path.resolve(process.argv[2] ?? "work/goal9-qa/forced-colors");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.request.delete(`${baseUrl}/api/session`);
  await page.request.delete(`${baseUrl}/api/compilation`);
  await page.goto(`${baseUrl}/`);

  await page.getByRole("button", { name: "Choose a form" }).focus();
  await page.screenshot({ path: path.join(outputDirectory, "upload-focus.png") });

  await page.locator(".sample-option").filter({ hasText: "Community Garden Day permission form" }).click();
  await page.getByRole("button", { name: /Start answering/ }).click();
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByRole("textbox", { name: "Your answer" }).focus();
  await page.screenshot({ path: path.join(outputDirectory, "talk-focus-progress.png") });

  await page.locator(".journey-step").filter({ hasText: "Review" }).click();
  await page.getByRole("heading", { name: "Your draft is ready to begin." }).waitFor();
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Answer now" }).first().focus();
  await page.screenshot({ path: path.join(outputDirectory, "review-blockers.png") });
  await page.getByRole("button", { name: "Continue answering" }).focus();
  await page.screenshot({ path: path.join(outputDirectory, "review-disabled-check.png") });

  await page.getByRole("button", { name: /Continue to download/ }).click();
  await page.getByRole("heading", { name: "Your draft is ready." }).waitFor();
  await page.screenshot({ path: path.join(outputDirectory, "download-disabled-export.png") });
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  forcedColors: "active",
  reducedMotion: "reduce",
  outputDirectory,
  screenshots: 5
}, null, 2));
