import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.VOCAFORM_DEMO_URL || "http://127.0.0.1:5183";
const outputRoot = path.resolve(
  process.env.VOCAFORM_VIDEO_DIR || "work/video/iterations/v5-final/product"
);

await fs.mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"]
});

try {
  const context = await browser.newContext({
    baseURL: baseUrl,
    colorScheme: "light",
    deviceScaleFactor: 1,
    recordVideo: {
      dir: outputRoot,
      size: { width: 1920, height: 1080 }
    },
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  const rawVideo = page.video();

  const session = await page.request.delete(`${baseUrl}/api/session`);
  if (!session.ok()) throw new Error("Could not reset the demo session");
  const compilation = await page.request.delete(`${baseUrl}/api/compilation`);
  if (!compilation.ok()) throw new Error("Could not reset the demo compilation");

  await page.goto("/");
  await settle(page);
  await page.evaluate(() => {
    const skipLink = document.querySelector(".skip-link");
    if (skipLink instanceof HTMLElement) skipLink.style.visibility = "hidden";
  });
  await page.waitForTimeout(4_600);

  const sample = page.locator(".sample-option").filter({
    hasText: "New patient medical intake"
  });
  await sample.hover();
  await page.waitForTimeout(350);
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/session/fixture")
      && candidate.request().method() === "POST"
  );
  await sample.click();
  if (!(await response).ok()) throw new Error("The medical sample did not open");
  await settle(page);
  await page.waitForTimeout(4_000);

  const destination = path.join(outputRoot, "scene-02-final-start.webm");
  await page.close();
  await rawVideo.saveAs(destination);
  await context.close();
  process.stdout.write(`${destination}\n`);
} finally {
  await browser.close();
}

async function settle(page) {
  await page.locator(".notice.busy").waitFor({ state: "hidden", timeout: 30_000 });
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
  });
}
