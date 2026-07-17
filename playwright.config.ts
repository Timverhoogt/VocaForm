import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const clientPort = 5183;
const apiPort = 5187;
const baseURL = `http://127.0.0.1:${clientPort}`;

export default defineConfig({
  testDir: "./app/e2e",
  testMatch: ["**/*.visual.spec.ts", "**/accessibility.spec.ts", "**/web_form_interview.spec.ts"],
  outputDir: "work/playwright/results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 90_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "work/playwright/report", open: "never" }]
  ],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.002,
      scale: "css"
    }
  },
  use: {
    baseURL,
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    locale: "en-US",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Amsterdam",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev:e2e",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      OPENAI_API_KEY: "",
      PORT: String(apiPort),
      VITE_PORT: String(clientPort),
      VOCAFORM_WORK_DIR: path.resolve("work/playwright/vault")
    }
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"]
      }
    }
  ]
});
