import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.VOCAFORM_DEMO_URL || "http://127.0.0.1:5183";
const outputRoot = path.resolve(process.env.VOCAFORM_VIDEO_DIR || "work/video/product");
const scene = process.argv[2] || "scene-02";
const fakeMicPath = path.join(outputRoot, "fake-mic", "scene-03-answers.wav");

await fs.mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: scene === "scene-03" ? [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${fakeMicPath}`
  ] : []
});

try {
  if (scene === "scene-02") {
    await captureScene02(browser);
  } else if (scene === "scene-03") {
    await captureScene03(browser);
  } else if (scene === "scene-04") {
    await captureScene04(browser);
  } else if (scene === "scene-05") {
    await captureScene05(browser);
  } else {
    throw new Error(`Unknown scene ${scene}`);
  }
} finally {
  await browser.close();
}

async function captureScene02(browserInstance) {
  const context = await browserInstance.newContext({
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

  await resetApplication(page);
  await page.goto("/");
  await settle(page);
  await hideTestingChrome(page);
  await page.waitForTimeout(1_500);

  const medicalSample = page.locator(".sample-option").filter({
    hasText: "New patient medical intake"
  });
  await medicalSample.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await medicalSample.hover();
  await page.waitForTimeout(450);

  const fixtureResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/fixture")
      && response.request().method() === "POST"
  );
  await medicalSample.click();
  if (!(await fixtureResponse).ok()) {
    throw new Error("Medical fixture did not open successfully");
  }
  await settle(page);

  const understoodHeading = page.locator(".experience-card").getByRole("heading", {
    name: "Riverside Family Practice — New Patient Intake"
  });
  await understoodHeading.waitFor({ state: "visible" });
  await page.waitForTimeout(3_600);
  await page.locator(".experience-card").getByRole("button", {
    name: "Start answering"
  }).hover();
  await page.waitForTimeout(1_000);

  const destination = path.join(outputRoot, "scene-02-upload-understand.webm");
  await page.close();
  await rawVideo.saveAs(destination);
  await context.close();
  process.stdout.write(`${destination}\n`);
}

async function captureScene03(browserInstance) {
  await fs.access(fakeMicPath);
  await prepareVoiceDemo(browserInstance);

  const context = await browserInstance.newContext({
    baseURL: baseUrl,
    colorScheme: "light",
    deviceScaleFactor: 1,
    permissions: ["microphone"],
    recordVideo: {
      dir: outputRoot,
      size: { width: 1920, height: 1080 }
    },
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  const rawVideo = page.video();

  await page.goto("/");
  await settle(page);
  await hideTestingChrome(page);
  await page.locator(".journey").getByRole("button", { name: "Talk" }).click();

  const voicePanel = page.locator("#voice-answer-panel");
  await voicePanel.getByRole("heading", {
    name: "Ready for a calm conversation?"
  }).waitFor({ state: "visible" });
  await page.waitForTimeout(1_800);

  const voiceButton = voicePanel.getByRole("button", { name: "Start voice conversation" });
  await voiceButton.hover();
  await page.waitForTimeout(400);
  await voiceButton.click();
  await voicePanel.getByText("Connected", { exact: true }).waitFor({
    state: "visible",
    timeout: 30_000
  }).catch(() => undefined);

  await page.waitForFunction(() => {
    const progress = document.querySelector(".progress-copy span")?.textContent || "";
    const completed = Number(progress.match(/^(\d+)/)?.[1] || 0);
    return completed >= 6;
  }, undefined, { timeout: 65_000 });
  await voicePanel.getByText("Listening", { exact: true }).waitFor({
    state: "visible",
    timeout: 20_000
  });
  await page.waitForTimeout(2_200);

  const endVoiceButton = voicePanel.getByRole("button", { name: "End voice conversation" });
  if (await endVoiceButton.isVisible()) {
    await endVoiceButton.click();
    await page.waitForTimeout(1_600);
  }

  const destination = path.join(outputRoot, "scene-03-voice-interview.webm");
  await page.close();
  await rawVideo.saveAs(destination);
  await context.close();
  process.stdout.write(`${destination}\n`);
}

async function prepareVoiceDemo(browserInstance) {
  const context = await browserInstance.newContext({
    baseURL: baseUrl,
    colorScheme: "light",
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  await resetApplication(page);
  await page.goto("/");
  await settle(page);
  await openSample(page, "New patient medical intake");

  const experience = page.locator(".experience-card");
  await experience.getByRole("button", { name: "Start answering" }).click();
  await page.getByRole("button", { name: "Type" }).click();
  await saveCurrentAnswer(page, "Taylor Morgan");
  await saveCurrentAnswer(page, "1988-05-12");
  await saveCurrentAnswer(page, "+31 20 555 0101");
  await saveCurrentAnswer(page, "taylor@example.test");
  await context.close();
}

async function captureScene05(browserInstance) {
  await prepareMemoryDemo(browserInstance);

  const context = await browserInstance.newContext({
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

  await page.goto("/");
  await settle(page);
  await hideTestingChrome(page);
  await page.waitForTimeout(800);

  const memoryButton = page.locator(".memory-button");
  await memoryButton.hover();
  await page.waitForTimeout(350);
  await memoryButton.click();
  const memoryDialog = page.getByRole("dialog", { name: "What VocaForm remembers" });
  await memoryDialog.waitFor({ state: "visible" });
  await page.waitForTimeout(2_400);
  await memoryDialog.getByRole("button", { name: "Close memory" }).click();

  const sessionReset = await page.request.delete(`${baseUrl}/api/session`);
  const compilationReset = await page.request.delete(`${baseUrl}/api/compilation`);
  if (!sessionReset.ok() || !compilationReset.ok()) {
    throw new Error("Could not close the remembered demo form");
  }
  await page.reload();
  await settle(page);
  await page.waitForTimeout(700);

  await openSample(page, "Elementary school intake");
  await page.locator(".memory-suggestion-card").first().waitFor({ state: "visible" });
  await page.waitForTimeout(2_600);

  const suggestionLabels = [
    "Namen van ouders/verzorgers",
    "Telefoonnummer ouder/verzorger",
    "E-mailadres ouder/verzorger"
  ];
  for (const label of suggestionLabels) {
    const suggestion = page.locator(".memory-suggestion-card").filter({ hasText: label });
    const useButton = suggestion.getByRole("button", {
      name: `Use remembered ${label}`,
      exact: true
    });
    await useButton.hover();
    await page.waitForTimeout(250);
    await useButton.click();
    await page.waitForTimeout(450);
  }

  const experience = page.locator(".experience-card");
  await page.locator(".journey").getByRole("button", { name: "Review" }).click();
  await experience.getByRole("heading", {
    name: "Your draft is ready to begin."
  }).waitFor({ state: "visible" });
  await page.locator(".memory-prefills").scrollIntoViewIfNeeded();
  await page.waitForTimeout(3_200);

  const destination = path.join(outputRoot, "scene-05-memory.webm");
  await page.close();
  await rawVideo.saveAs(destination);
  await context.close();
  process.stdout.write(`${destination}\n`);
}

async function captureScene04(browserInstance) {
  await prepareVerificationDemo(browserInstance);

  const context = await browserInstance.newContext({
    acceptDownloads: true,
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

  await page.goto("/");
  await settle(page);
  await hideTestingChrome(page);
  await page.locator(".journey").getByRole("button", { name: "Review" }).click();

  const experience = page.locator(".experience-card");
  await experience.getByRole("heading", { name: "7 answers saved." }).waitFor({ state: "visible" });
  const verificationPanel = page.locator(".verification-panel");
  await verificationPanel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2_400);

  const patientFinding = page.locator(".finding-card").filter({ hasText: "Full legal name" });
  await patientFinding.getByRole("button", {
    name: "Answer now for Full legal name",
    exact: true
  }).click();
  const patientAnswer = patientFinding.getByRole("textbox", {
    name: "Your answer for Full legal name",
    exact: true
  });
  await patientAnswer.fill("Taylor Morgan");
  await page.waitForTimeout(650);
  await patientFinding.getByRole("button", {
    name: "Save answer for Full legal name",
    exact: true
  }).click();
  await patientFinding.waitFor({ state: "detached" });
  await page.waitForTimeout(1_100);

  const verifyButton = verificationPanel.getByRole("button", {
    name: "Run final verification"
  });
  await verifyButton.scrollIntoViewIfNeeded();
  await verifyButton.hover();
  await page.waitForTimeout(400);
  await verifyButton.click();
  await page.locator(".notice.busy").waitFor({ state: "visible", timeout: 5_000 });
  await page.locator(".notice.busy").waitFor({ state: "hidden", timeout: 120_000 });

  const verificationStatus = (await page.locator(".verification-status").innerText()).trim();
  if (verificationStatus !== "Ready") {
    throw new Error(`Live final verification returned ${verificationStatus}`);
  }
  await verificationPanel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2_500);

  await experience.getByRole("button", { name: /Continue to download/ }).click();
  await experience.getByRole("heading", {
    name: "Your completed document is ready."
  }).waitFor({ state: "visible" });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(2_400);

  const finalDownload = experience.getByRole("button", { name: /Download verified PDF/ });
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await finalDownload.click();
  const download = await downloadPromise;
  await download.saveAs(path.join(outputRoot, "scene-04-verified-output.pdf"));
  await experience.getByText("Download complete", { exact: true }).waitFor({ state: "visible" });
  await page.waitForTimeout(2_600);

  const destination = path.join(outputRoot, "scene-04-review-verify-download.webm");
  await page.close();
  await rawVideo.saveAs(destination);
  await context.close();
  process.stdout.write(`${destination}\n`);
}

async function prepareVerificationDemo(browserInstance) {
  const context = await browserInstance.newContext({
    baseURL: baseUrl,
    colorScheme: "light",
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  await resetApplication(page);
  await page.goto("/");
  await settle(page);
  await openSample(page, "New patient medical intake");

  const experience = page.locator(".experience-card");
  await experience.getByRole("button", { name: "Start answering" }).click();
  await page.getByRole("button", { name: "Type" }).click();
  await skipCurrentAnswer(page);
  await saveCurrentAnswer(page, "1988-05-12");
  await saveCurrentAnswer(page, "+31 20 555 0101");
  await saveCurrentAnswer(page, "taylor@example.test");
  await saveCurrentAnswer(page, "Recurring headaches");
  await saveCurrentAnswer(page, "None");
  await saveCurrentAnswer(page, "Yes");
  await saveCurrentAnswer(page, "Penicillin - rash");
  await context.close();
}

async function prepareMemoryDemo(browserInstance) {
  const context = await browserInstance.newContext({
    baseURL: baseUrl,
    colorScheme: "light",
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  await resetApplication(page);
  await page.goto("/");
  await settle(page);
  await openSample(page, "Community Garden Day permission form");

  const experience = page.locator(".experience-card");
  await experience.getByRole("button", { name: "Start answering" }).click();
  await page.getByRole("button", { name: "Type" }).click();

  await saveCurrentAnswer(page, "Mila Hart");
  await saveCurrentAnswer(page, "Alex Hart");
  await saveCurrentAnswer(page, "+31 6 12345678");
  await saveCurrentAnswer(page, "alex@example.test");
  await saveCurrentAnswer(page, "Yes");
  await saveCurrentAnswer(page, "Picked up");
  await skipCurrentAnswer(page);
  await saveCurrentAnswer(page, "No");

  const rememberLabels = [
    "Parent or guardian name",
    "Daytime phone number",
    "Parent or guardian email"
  ];
  for (const label of rememberLabels) {
    const card = page.locator(".remember-candidate-card").filter({ hasText: label });
    await card.getByRole("button", { name: `Remember ${label}`, exact: true }).click();
  }
  await context.close();
}

async function resetApplication(page) {
  const response = await page.request.delete(`${baseUrl}/api/session`);
  if (!response.ok()) throw new Error("Could not reset the demo session");
  const compilation = await page.request.delete(`${baseUrl}/api/compilation`);
  if (!compilation.ok()) throw new Error("Could not reset the demo compilation");
  const memoryResponse = await page.request.get(`${baseUrl}/api/memory`);
  if (!memoryResponse.ok()) throw new Error("Could not read the demo memory");
  const memory = await memoryResponse.json();
  for (const claim of memory.claims || []) {
    const deletion = await page.request.delete(`${baseUrl}/api/memory/claims/${claim.id}`);
    if (!deletion.ok()) throw new Error(`Could not delete memory claim ${claim.id}`);
  }
}

async function openSample(page, title) {
  const option = page.locator(".sample-option").filter({ hasText: title });
  const fixtureResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/fixture")
      && response.request().method() === "POST"
  );
  await option.click();
  if (!(await fixtureResponse).ok()) {
    throw new Error(`Sample ${title} did not open successfully`);
  }
  await settle(page);
}

async function saveCurrentAnswer(page, value) {
  const choiceDialog = page.locator(".choice-modal");
  if (await choiceDialog.count() === 1 && await choiceDialog.isVisible()) {
    const radio = choiceDialog.getByRole("radio", { name: value, exact: true });
    const checkbox = choiceDialog.getByRole("checkbox", { name: value, exact: true });
    const control = await radio.count() === 1 ? radio : checkbox;
    await control.check();
  } else {
    await page.getByRole("textbox", { name: "Your answer" }).fill(value);
  }
  const answerResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/answer")
      && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /Save and continue/ }).click();
  if (!(await answerResponse).ok()) throw new Error("Could not save demo answer");
  await settle(page);
}

async function skipCurrentAnswer(page) {
  const skipResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/skip")
      && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /answer this later/i }).click();
  if (!(await skipResponse).ok()) throw new Error("Could not skip demo answer");
  await settle(page);
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

async function hideTestingChrome(page) {
  await page.evaluate(() => {
    const skipLink = document.querySelector(".skip-link");
    if (skipLink instanceof HTMLElement) skipLink.style.visibility = "hidden";
  });
}
