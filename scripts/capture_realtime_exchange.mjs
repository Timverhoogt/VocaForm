import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.VOCAFORM_DEMO_URL || "http://127.0.0.1:5183";
const outputRoot = path.resolve(
  process.env.VOCAFORM_VIDEO_DIR || "work/video/iterations/v4-realtime-demo/product"
);
const fakeMicPath = path.resolve(
  process.env.VOCAFORM_FAKE_MIC_PATH
    || "work/video/iterations/v2/product/fake-mic/scene-03-answers.wav"
);

await fs.mkdir(outputRoot, { recursive: true });
await fs.access(fakeMicPath);

const browser = await chromium.launch({
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${fakeMicPath}`
  ]
});

try {
  const visitorCookies = await prepareVoiceDemo(browser);

  const context = await browser.newContext({
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
  await context.addCookies(visitorCookies);
  await installMixedAudioCapture(context);

  const pageCreatedAt = Date.now();
  const page = await context.newPage();
  const rawVideo = page.video();

  await page.goto("/");
  await settle(page);
  await hideTestingChrome(page);
  await page.locator(".journey").getByRole("button", { name: "Talk" }).click();

  const voicePanel = page.locator("#voice-answer-panel");
  await voicePanel.getByRole("heading", { name: "Ready for a calm conversation?" })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(1_000);

  const voiceButton = voicePanel.getByRole("button", { name: "Start voice conversation" });
  await voiceButton.click();

  await page.locator(".voice-panel.state-speaking").waitFor({
    state: "visible",
    timeout: 45_000
  });
  await page.locator(".voice-panel.state-listening").waitFor({
    state: "visible",
    timeout: 45_000
  });
  await page.waitForFunction(() => {
    const progress = document.querySelector(".progress-copy span")?.textContent || "";
    const completed = Number(progress.match(/^(\d+)/)?.[1] || 0);
    return completed >= 5;
  }, undefined, { timeout: 65_000 });
  await page.locator(".voice-panel.state-speaking").waitFor({
    state: "visible",
    timeout: 35_000
  });
  await page.locator(".voice-panel.state-listening").waitFor({
    state: "visible",
    timeout: 35_000
  });
  await page.waitForTimeout(1_200);

  const recorded = await page.evaluate(async () => {
    if (typeof window.__vocaformStopMixedCapture !== "function") {
      throw new Error("The mixed Realtime audio recorder did not start.");
    }
    return window.__vocaformStopMixedCapture();
  });
  const videoOffsetSeconds = Math.max(0, (recorded.startedAtEpochMs - pageCreatedAt) / 1000);

  const endVoiceButton = voicePanel.getByRole("button", { name: "End voice conversation" });
  if (await endVoiceButton.isVisible()) await endVoiceButton.click();
  await page.waitForTimeout(400);

  const videoPath = path.join(outputRoot, "scene-03-realtime-live.webm");
  const audioPath = path.join(outputRoot, "scene-03-realtime-live-audio.webm");
  await page.close();
  await rawVideo.saveAs(videoPath);
  await context.close();
  await fs.writeFile(audioPath, Buffer.from(recorded.base64, "base64"));
  await fs.writeFile(path.join(outputRoot, "scene-03-realtime-live.json"), `${JSON.stringify({
    videoPath,
    audioPath,
    videoOffsetSeconds,
    audioMimeType: recorded.mimeType,
    capturedAt: new Date().toISOString()
  }, null, 2)}\n`);

  process.stdout.write(`${videoPath}\n${audioPath}\n`);
} finally {
  await browser.close();
}

async function installMixedAudioCapture(context) {
  await context.addInitScript(() => {
    let localStream = null;
    let recorder = null;
    let recorderChunks = [];
    let audioContext = null;
    let startedAtEpochMs = 0;

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints) => {
        const stream = await originalGetUserMedia(constraints);
        localStream = stream;
        return stream;
      }
    });

    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject");
    if (!descriptor?.set || !descriptor.get) return;

    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(stream) {
        descriptor.set.call(this, stream);
        if (!(stream instanceof MediaStream) || !localStream || recorder) return;

        audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        const remoteSource = audioContext.createMediaStreamSource(stream);
        const localSource = audioContext.createMediaStreamSource(localStream);
        const remoteGain = audioContext.createGain();
        const localGain = audioContext.createGain();
        remoteGain.gain.value = 1;
        localGain.gain.value = 0.9;
        remoteSource.connect(remoteGain).connect(destination);
        localSource.connect(localGain).connect(destination);
        void audioContext.resume();

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        recorder = new MediaRecorder(destination.stream, { mimeType });
        recorderChunks = [];
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) recorderChunks.push(event.data);
        });
        startedAtEpochMs = Date.now();
        recorder.start(500);

        window.__vocaformStopMixedCapture = () => new Promise((resolve, reject) => {
          if (!recorder || recorder.state === "inactive") {
            reject(new Error("The mixed Realtime audio recorder is inactive."));
            return;
          }
          recorder.addEventListener("stop", () => {
            const blob = new Blob(recorderChunks, { type: recorder.mimeType });
            const reader = new FileReader();
            reader.addEventListener("error", () => reject(reader.error));
            reader.addEventListener("load", () => {
              const value = String(reader.result || "");
              resolve({
                base64: value.slice(value.indexOf(",") + 1),
                mimeType: recorder.mimeType,
                startedAtEpochMs
              });
              void audioContext?.close();
            });
            reader.readAsDataURL(blob);
          }, { once: true });
          recorder.stop();
        });
      }
    });
  });
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
  const cookies = await context.cookies();
  await context.close();
  return cookies;
}

async function resetApplication(page) {
  const response = await page.request.delete(`${baseUrl}/api/session`);
  if (!response.ok()) throw new Error("Could not reset the demo session");
  const compilation = await page.request.delete(`${baseUrl}/api/compilation`);
  if (!compilation.ok()) throw new Error("Could not reset the demo compilation");
}

async function openSample(page, title) {
  const option = page.locator(".sample-option").filter({ hasText: title });
  const fixtureResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/fixture")
      && response.request().method() === "POST"
  );
  await option.click();
  if (!(await fixtureResponse).ok()) throw new Error(`Sample ${title} did not open successfully`);
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
