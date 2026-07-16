import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

interface SessionPayload {
  session: {
    answers: Record<string, { status: string; source: string; rawAnswer: string | null }>;
  };
}

interface MemoryPayload {
  claims: Array<{ id: string }>;
}

test.beforeEach(async ({ request }) => {
  await resetApplication(request);
});

test("Goal 5 blocks final export and resolves findings without restarting", async ({ page, request }) => {
  await page.goto("/");
  await openSample(page, "Community Garden Day permission form");
  const experience = page.locator(".experience-card");
  await experience.getByRole("button", { name: /Start answering/ }).click();
  await page.getByRole("button", { name: "Type" }).click();

  await skipCurrentAnswer(page);
  await saveCurrentAnswer(page, "Alex Hart");
  await saveCurrentAnswer(page, "+31 6 12345678");
  await skipCurrentAnswer(page);
  await saveCurrentAnswer(page, "Yes");
  await saveCurrentAnswer(page, "Picked up");
  await skipCurrentAnswer(page);
  await saveCurrentAnswer(page, "No");

  await expect(experience.getByRole("heading", { name: "5 answers saved." })).toBeVisible();
  const continueToDownload = experience.getByRole("button", { name: /Continue to download/ });
  await continueToDownload.click();
  const verifiedDownload = experience.getByRole("button", { name: /Download verified DOCX/ });
  await expect(verifiedDownload).toBeDisabled();
  await expect(experience.getByRole("button", { name: /Download draft DOCX/ })).toBeEnabled();
  await expectVisual(page, "download-blocked.png");
  await experience.getByRole("button", { name: "Back to review" }).click();
  const childFinding = page.locator(".finding-card").filter({ hasText: "Child's full name" });
  await expect(childFinding).toContainText("This required question was skipped.");
  await expect(childFinding).toContainText("Form rule check");
  const blockedExport = await request.post("/api/export/final");
  expect(blockedExport.status()).toBe(422);
  await expectVisual(page, "verification-blocked.png");

  await childFinding.getByRole("button", {
    name: "Answer now for Child's full name",
    exact: true
  }).click();
  await childFinding.getByRole("textbox", {
    name: "Your answer for Child's full name",
    exact: true
  }).fill("Mila Hart");
  const resolutionResponse = page.waitForResponse((response) =>
    response.url().includes("/api/session/verification/issues/")
      && response.url().endsWith("/resolve")
      && response.request().method() === "POST"
  );
  await childFinding.getByRole("button", {
    name: "Save answer for Child's full name",
    exact: true
  }).click();
  expect((await resolutionResponse).ok()).toBe(true);

  await expect(childFinding).toHaveCount(0);
  await expect(page.locator(".verification-run")).toContainText("automatic meaning check is unavailable");
  await continueToDownload.click();
  await expect(verifiedDownload).toBeDisabled();
  await experience.getByRole("button", { name: "Back to review" }).click();
  const stillBlockedExport = await request.post("/api/export/final");
  expect(stillBlockedExport.status()).toBe(422);
  const sessionResponse = await request.get("/api/session");
  const session = await sessionResponse.json() as SessionPayload;
  expect(session.session.answers.child_name).toMatchObject({
    status: "answered",
    source: "user_correction",
    rawAnswer: "Mila Hart"
  });
  await expectVisual(page, "verification-corrected-awaiting-sol.png");
});

async function resetApplication(request: APIRequestContext): Promise<void> {
  expect((await request.delete("/api/session")).ok()).toBe(true);
  expect((await request.delete("/api/compilation")).ok()).toBe(true);
  const memoryResponse = await request.get("/api/memory");
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
}

async function saveCurrentAnswer(page: Page, value: string): Promise<void> {
  const choiceDialog = page.locator(".choice-modal");
  if (await choiceDialog.count() === 1 && await choiceDialog.isVisible()) {
    const radio = choiceDialog.getByRole("radio", { name: value, exact: true });
    const checkbox = choiceDialog.getByRole("checkbox", { name: value, exact: true });
    const control = await radio.count() === 1 ? radio : checkbox;
    await control.check();
  } else {
    const answer = page.getByRole("textbox", { name: "Your answer" });
    await expect(answer).toBeVisible();
    await answer.fill(value);
  }
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/answer") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /Save and continue/ }).click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(page.locator(".notice.busy")).toHaveCount(0);
}

async function skipCurrentAnswer(page: Page): Promise<void> {
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/skip") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /answer this later/i }).click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(page.locator(".notice.busy")).toHaveCount(0);
}

async function expectVisual(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const skipLink = document.querySelector<HTMLElement>(".skip-link");
    if (skipLink) skipLink.style.visibility = "hidden";
  });
  await expect(page).toHaveScreenshot(name, { fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
