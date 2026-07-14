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

interface SessionPayload {
  session: {
    prefillAnswers: Record<string, { status: string }>;
  };
}

test.beforeEach(async ({ request }) => {
  await resetApplication(request);
});

test("Goal 4 memory remains explicit and visually traceable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "One form. One conversation. Done." })).toBeVisible();
  const skipLink = page.getByRole("link", { name: "Skip to the form" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  await skipLink.evaluate((element) => element.blur());
  await expectVisual(page, "landing.png");

  await openSample(page, "Community Garden Day permission form");
  const experience = page.locator(".experience-card");
  await expect(experience.getByRole("heading", { name: "Community Garden Day Permission Form" })).toBeVisible();
  await experience.getByRole("button", { name: /Start answering/ }).click();
  await expect(page.getByRole("button", { name: "Type" })).toHaveAttribute("aria-pressed", "true");

  await saveCurrentAnswer(page, "Mila Hart", 1);
  await saveCurrentAnswer(page, "Alex Hart", 2);
  await saveCurrentAnswer(page, "+31 6 12345678", 3);
  await saveCurrentAnswer(page, "alex@example.test", 4);
  await saveCurrentAnswer(page, "Yes", 5);
  await saveCurrentAnswer(page, "Picked up", 6);
  await skipCurrentAnswer(page);
  await saveCurrentAnswer(page, "No", 7);

  await expect(experience.getByRole("heading", { name: "7 answers saved." })).toBeVisible();
  await expect(page.locator(".remember-candidate-card")).toHaveCount(3);
  await expectVisual(page, "activity-review-candidates.png");

  for (const label of ["Parent or guardian name", "Daytime phone number", "Parent or guardian email"]) {
    const card = page.locator(".remember-candidate-card").filter({ hasText: label });
    await card.getByRole("button", { name: "Remember" }).click();
    await expect(card).toHaveCount(0);
  }

  const memoryButton = page.locator(".memory-button");
  await expect(memoryButton).toContainText("3");
  await memoryButton.click();
  const dialog = page.getByRole("dialog", { name: "What VocaForm remembers" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".vault-claim")).toHaveCount(3);
  await expect(dialog.locator(".drawer-close")).toBeFocused();

  const emailClaim = dialog.locator(".vault-claim").filter({ hasText: "Parent or guardian email" });
  await emailClaim.getByRole("button", { name: "Correct" }).click();
  await emailClaim.getByRole("textbox", { name: "Correct remembered value" })
    .fill("alex.updated@example.test");
  await emailClaim.getByRole("button", { name: "Save correction" }).click();
  await expect(emailClaim.locator(".claim-value")).toHaveText("alex.updated@example.test");
  await expectLocatorVisual(
    dialog,
    "memory-vault.png",
    dialog.locator(".vault-claim time")
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(memoryButton).toBeFocused();

  await experience.getByRole("button", { name: "Close this form and start over" }).click();
  await openSample(page, "Elementary school intake");
  await expect(experience.getByRole("heading", { name: "Dit ben ik" })).toBeVisible();
  await expect(page.locator(".memory-suggestion-card")).toHaveCount(3);
  await expect(page.getByText("alex.updated@example.test", { exact: true })).toBeVisible();

  const beforeApplyResponse = await request.get("/api/session");
  expect(beforeApplyResponse.ok()).toBe(true);
  const beforeApply = await beforeApplyResponse.json() as SessionPayload;
  expect(Object.values(beforeApply.session.prefillAnswers).every((answer) => answer.status === "unanswered"))
    .toBe(true);
  await expectVisual(page, "school-memory-suggestions.png");

  for (const label of [
    "Namen van ouders/verzorgers",
    "Telefoonnummer ouder/verzorger",
    "E-mailadres ouder/verzorger"
  ]) {
    const card = page.locator(".memory-suggestion-card").filter({ hasText: label });
    await card.getByRole("button", { name: "Use this" }).click();
    await expect(card).toHaveCount(0);
  }

  await page.locator(".journey").getByRole("button", { name: "Review" }).click();
  await expect(experience.getByRole("heading", { name: "Your draft is ready to begin." })).toBeVisible();
  await expect(page.locator(".memory-prefills .answer-row")).toHaveCount(3);
  await expect(page.locator(".memory-prefills")).toContainText("alex.updated@example.test");
  await expectVisual(page, "school-confirmed-memory.png");

  await memoryButton.click();
  await expect(dialog).toBeVisible();
  const phoneClaim = dialog.locator(".vault-claim").filter({ hasText: "Daytime phone number" });
  await phoneClaim.getByRole("button", { name: "Forget" }).click();
  await expect(dialog.locator(".vault-claim")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Close memory" }).click();

  await experience.getByRole("button", { name: "Close this form and start over" }).click();
  await openSample(page, "Elementary school intake");
  await expect(page.locator(".memory-suggestion-card")).toHaveCount(2);
  await expect(page.locator(".memory-suggestion-card").filter({
    hasText: "Telefoonnummer ouder/verzorger"
  })).toHaveCount(0);
  await expectVisual(page, "school-after-forget.png");
});

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

async function openSample(page: Page, title: string): Promise<void> {
  const option = page.locator(".sample-option").filter({ hasText: title });
  await expect(option).toBeVisible();
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/fixture") && response.request().method() === "POST"
  );
  await option.click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(page.locator(".notice")).not.toHaveText("Working…");
}

async function saveCurrentAnswer(page: Page, value: string, answeredCount: number): Promise<void> {
  const answer = page.getByRole("textbox", { name: "Your answer" });
  await expect(answer).toBeVisible();
  await answer.fill(value);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/answer") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /Save and continue/ }).click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(page.locator(".progress-copy span")).toHaveText(`${answeredCount} of 8 answered`);
  await expect(page.locator(".notice")).not.toHaveText("Working…");
}

async function skipCurrentAnswer(page: Page): Promise<void> {
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/skip") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /answer this later/i }).click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(page.locator(".text-answer-panel h2"))
    .toHaveText("Do you give permission for event photographs?");
}

async function expectVisual(page: Page, name: string): Promise<void> {
  await settleVisuals(page);
  await expect(page).toHaveScreenshot(name, { fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectLocatorVisual(locator: Locator, name: string, mask: Locator): Promise<void> {
  await settleVisuals(locator.page());
  await expect(locator).toHaveScreenshot(name, {
    mask: [mask],
    maskColor: "#ffffff"
  });
}

async function settleVisuals(page: Page): Promise<void> {
  await expect(page.locator(".notice")).not.toHaveText("Working…");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const skipLink = document.querySelector<HTMLElement>(".skip-link");
    if (skipLink) skipLink.style.visibility = "hidden";
  });
  await expect(page.locator(".skip-link")).not.toBeFocused();
}
