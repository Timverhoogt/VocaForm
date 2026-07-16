import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page
} from "@playwright/test";

interface MemoryPayload {
  claims: Array<{ id: string }>;
}

test.beforeEach(async ({ request }) => {
  await resetApplication(request);
});

test("Goal 7 completes the prepared form with a keyboard and clear screen-reader structure", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "One form. One conversation. Done." })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "Upload landing");
  await expectLargeTargets(page);

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to the form" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  const sample = page.locator(".sample-option").filter({
    hasText: "Community Garden Day permission form"
  });
  await tabTo(page, sample);
  const fixtureResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/fixture") && response.request().method() === "POST"
  );
  await page.keyboard.press("Enter");
  expect((await fixtureResponse).ok()).toBe(true);

  const experience = page.locator(".experience-card");
  const understoodHeading = experience.getByRole("heading", {
    name: "Community Garden Day Permission Form"
  });
  await expect(understoodHeading).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page, "Prepared form summary");

  const startButton = experience.getByRole("button", { name: /Start answering/ });
  await tabTo(page, startButton);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Type" })).toHaveAttribute("aria-pressed", "true");
  await expect(experience.locator("[data-stage-heading]")).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page, "Typed interview");

  for (const value of ["Mila Hart", "Alex Hart", "+31 6 12345678", "alex@example.test"]) {
    await saveInterviewAnswerWithKeyboard(page, value);
  }

  const attendanceChoices = page.getByRole("dialog", {
    name: "May your child attend Community Garden Day?"
  });
  await expect(attendanceChoices).toBeVisible();
  await expect(attendanceChoices.getByRole("radio", { name: "Yes", exact: true })).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page, "Choice question modal");

  for (const value of ["Yes", "Picked up", "No additional support needed", "No"]) {
    await saveInterviewAnswerWithKeyboard(page, value);
  }

  const reviewHeading = experience.getByRole("heading", { name: "8 answers saved." });
  await expect(reviewHeading).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Form steps" })
    .getByRole("button", { name: "Review" })).toHaveAttribute("aria-current", "step");
  await expectNoSeriousAccessibilityViolations(page, "Review");

  const continueToDownload = experience.getByRole("button", { name: /Continue to download/ });
  await tabTo(page, continueToDownload, 80);
  await page.keyboard.press("Enter");
  await expect(experience.getByRole("heading", { name: "Your draft is ready." })).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page, "Format-aware download");

  const draftButton = experience.getByRole("button", { name: /Download draft DOCX/ });
  await tabTo(page, draftButton);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.docx$/i);
  await expect(experience.getByText("Download complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Download complete");
});

test("Goal 7 announces a failed action and offers a keyboard-operable recovery", async ({ page }) => {
  let fixtureAttempts = 0;
  await page.route("**/api/session/fixture", async (route) => {
    fixtureAttempts += 1;
    if (fixtureAttempts === 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "The reviewed form could not be opened." })
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  const sample = page.locator(".sample-option").filter({
    hasText: "Community Garden Day permission form"
  });
  await sample.click();
  await expect(page.getByRole("status")).toContainText("Opening and checking the reviewed form");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The reviewed form could not be opened.");
  await expectNoSeriousAccessibilityViolations(page, "Actionable error");

  const retry = alert.getByRole("button", { name: "Try opening the form again" });
  await tabTo(page, retry);
  await page.keyboard.press("Enter");
  await expect(page.locator(".experience-card").getByRole("heading", {
    name: "Community Garden Day Permission Form"
  })).toBeFocused();
  expect(fixtureAttempts).toBe(2);
});

test("Goal 7 remains usable with text resized to 200 percent", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expectNoHorizontalOverflow(page, "Upload at 200% text size");

  const sample = page.locator(".sample-option").filter({
    hasText: "Community Garden Day permission form"
  });
  await sample.click();
  await expect(page.locator(".experience-card").getByRole("heading", {
    name: "Community Garden Day Permission Form"
  })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Prepared form at 200% text size");

  await page.getByRole("button", { name: /Start answering/ }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Interview at 200% text size");

  await page.getByRole("navigation", { name: "Form steps" })
    .getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Your draft is ready to begin." })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Review at 200% text size");

  await page.getByRole("button", { name: /Continue to download/ }).click();
  await expect(page.getByRole("heading", { name: "Your draft is ready." })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Download at 200% text size");
});

test("Goal 9 review gate supports low-vision reflow and forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/");

  await expectNoHorizontalOverflow(page, "Upload at a 320 CSS-pixel reflow width");
  await expectNoSeriousAccessibilityViolations(page, "Upload in forced-colors mode");

  const uploadButton = page.getByRole("button", { name: "Choose a form" });
  const forcedColorBorder = await uploadButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.borderTopStyle,
      width: style.borderTopWidth
    };
  });
  expect(forcedColorBorder.style).toBe("solid");
  expect(Number.parseFloat(forcedColorBorder.width)).toBeGreaterThanOrEqual(1);

  const sample = page.locator(".sample-option").filter({
    hasText: "Community Garden Day permission form"
  });
  await sample.click();
  const experienceTop = await page.locator(".experience-card").evaluate((element) =>
    element.getBoundingClientRect().top
  );
  const statusTop = await page.locator(".status-card").evaluate((element) =>
    element.getBoundingClientRect().top
  );
  expect(experienceTop, "The active task should precede the full status card at narrow widths.")
    .toBeLessThan(statusTop);
  await page.getByRole("button", { name: /Start answering/ }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toBeVisible();

  await expectNoHorizontalOverflow(page, "Interview at a 320 CSS-pixel reflow width");
  await expectNoSeriousAccessibilityViolations(page, "Interview in forced-colors mode");
});

test("Goal 9 marks Dutch form content with Dutch language boundaries", async ({ page }) => {
  await page.goto("/");
  const sample = page.locator(".sample-option").filter({
    hasText: "Elementary school intake"
  });
  await sample.click();

  const experience = page.locator(".experience-card");
  const title = experience.getByRole("heading", { name: "Entreeformulier Dit ben ik" });
  await expect(title).toHaveAttribute("lang", "nl-NL");
  await expect(title).toHaveAttribute("dir", "auto");
  await expect(page.locator(".status-card").getByRole("heading", {
    name: "Entreeformulier Dit ben ik"
  })).toHaveAttribute("lang", "nl-NL");

  await page.getByRole("button", { name: /Start answering/ }).click();
  const typeButton = page.getByRole("button", { name: "Type" });
  if (await typeButton.getAttribute("aria-pressed") !== "true") await typeButton.click();

  await expect(experience.locator(".question-meta [lang='nl-NL']")).toContainText("Levensgeschiedenis");
  await expect(experience.locator("[data-stage-heading]")).toHaveAttribute("lang", "nl-NL");
  await expect(experience.locator("[data-stage-heading]")).toHaveAttribute("dir", "auto");
  await expect(experience.locator("#answer-help [lang='nl-NL']")).not.toBeEmpty();
  await expectNoSeriousAccessibilityViolations(page, "Dutch typed interview");
});

test("Goal 9 explains isolated and temporary public-demo state", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      json: {
        status: "ok",
        version: "test",
        deployment: { publicDemo: true, storage: "ephemeral" },
        openai: {
          configured: false,
          model: "gpt-5.6-sol",
          realtimeModel: "gpt-realtime-2.1",
          verificationModel: "gpt-5.6-sol",
          verificationMode: "standard"
        }
      }
    });
  });
  await page.goto("/");

  const notice = page.locator(".public-demo-notice");
  await expect(notice).toContainText("isolated to this browser session");
  await expect(notice).toContainText("not written to demo storage");
  await expect(notice).toContainText("expires after at most two hours");
  await expect(notice).toContainText("host filesystem is also temporary");
  await expectNoHorizontalOverflow(page, "Public-demo warning");
  await expectNoSeriousAccessibilityViolations(page, "Public-demo warning");
});

async function saveInterviewAnswerWithKeyboard(page: Page, value: string): Promise<void> {
  const choiceDialog = page.locator(".choice-modal");
  const choiceIsOpen = await choiceDialog.count() === 1 && await choiceDialog.isVisible();

  if (choiceIsOpen) {
    const radio = choiceDialog.getByRole("radio", { name: value, exact: true });
    const checkbox = choiceDialog.getByRole("checkbox", { name: value, exact: true });
    if (await radio.count() === 1) {
      const radioCount = await choiceDialog.getByRole("radio").count();
      for (let index = 0; index < radioCount; index += 1) {
        if (await radio.evaluate((element) => element === document.activeElement)) break;
        await page.keyboard.press("ArrowDown");
      }
      await expect(radio).toBeFocused();
      await page.keyboard.press("Space");
    } else {
      await tabTo(page, checkbox);
      await page.keyboard.press("Space");
    }
  } else {
    const textbox = page.getByRole("textbox", { name: "Your answer" });
    await tabTo(page, textbox);
    await page.keyboard.insertText(value);
  }

  const saveButton = page.getByRole("button", { name: /Save and continue/ });
  await tabTo(page, saveButton);
  const answerResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/answer") && response.request().method() === "POST"
  );
  await page.keyboard.press("Enter");
  expect((await answerResponse).ok()).toBe(true);
  await expect(page.locator(".notice.busy")).toHaveCount(0);
}

async function resetApplication(request: APIRequestContext): Promise<void> {
  expect((await request.delete("/api/session")).ok()).toBe(true);
  expect((await request.delete("/api/compilation")).ok()).toBe(true);
  const memoryResponse = await request.get("/api/memory");
  expect(memoryResponse.ok()).toBe(true);
  const memory = await memoryResponse.json() as MemoryPayload;
  for (const claim of memory.claims) {
    expect((await request.delete(`/api/memory/claims/${claim.id}`)).ok()).toBe(true);
  }
}

async function tabTo(page: Page, target: Locator, limit = 40): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute("class") || "the requested control"}.`);
}

async function expectNoSeriousAccessibilityViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious"
  );
  expect(violations, `${context}: ${formatViolations(violations)}`).toEqual([]);
}

async function expectLargeTargets(page: Page): Promise<void> {
  const undersized = await page.locator("button:not(:disabled), summary").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width < 44 || bounds.height < 44
        ? [`${element.textContent?.trim() || element.tagName}: ${bounds.width}×${bounds.height}`]
        : [];
    })
  );
  expect(undersized, "Every available action should have at least a 44 by 44 CSS pixel target.").toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowers: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => ({
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        tagName: element.tagName,
        text: element.textContent?.trim().slice(0, 80) || ""
      }))
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
  }));
  expect(dimensions.scrollWidth, `${context}: ${JSON.stringify(dimensions.overflowers)}`)
    .toBeLessThanOrEqual(dimensions.clientWidth);
}

function formatViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string {
  return violations.map((violation) => {
    const targets = violation.nodes.flatMap((node) => node.target).join(", ");
    return `${violation.id} (${violation.impact}): ${targets}`;
  }).join("; ");
}
