/*
This file checks sign-in, private room play, admin question editing, and logout in a real browser.
Edit it when account, multiplayer, or question editor flows change; copy a scenario for another full browser path.
*/

import { expect, test, type Page } from "@playwright/test";

test("a new player can register, reload, and start a dive", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(request.url()));
  await page.goto("/");
  await page.getByRole("link", { name: "Create account" }).click();
  await expect(page).toHaveURL("/register");
  await page.getByLabel("Username").fill(`newdiver${Date.now()}`);
  await page.getByLabel("Password").fill("new-player-password");
  const registration = page.waitForResponse((response) => response.url().endsWith("/api/auth/register"));
  await page.getByRole("button", { name: "Create account" }).click();
  expect((await registration).status()).toBe(201);
  await expect(page).toHaveURL("/");
  await page.reload();
  await page.getByRole("button", { name: "Play solo" }).click();
  await expect(page.getByText("Prompt 1 of 7")).toBeVisible();
  expect(errors).toEqual([]);
});

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
}

test("solo dive starts immediately and resumes after reload", async ({ page }) => {
  await signIn(page, "user", "user");
  await page.getByRole("button", { name: /play solo/i }).click();
  await expect(page.getByText("Prompt 1 of 7")).toBeVisible();
  await expect(page.locator(".diving-krill")).toHaveCount(1);
  const prompt = await page.locator(".question-panel h2").innerText();
  await page.reload();
  await expect(page.getByText("Prompt 1 of 7")).toBeVisible();
  await expect(page.locator(".question-panel h2")).toHaveText(prompt);
  await expect(page.getByRole("textbox", { name: "Your answer" })).toBeVisible();
});

test("endless dive advances and shows color-coded answers after finishing", async ({ page }) => {
  await signIn(page, "admin", "admin");
  await page.getByLabel("Dive category").selectOption("Mathematics");
  await page.getByRole("button", { name: /play endless/i }).click();
  await expect(page.getByText("Endless · Prompt 1")).toBeVisible();
  await expect(page.locator(".question-category")).toHaveText("Mathematics");
  const prompt = await page.locator(".question-panel h2").innerText();
  const response = await page.request.post("/api/game/questions/list");
  expect(response.ok()).toBeTruthy();
  const { data } = (await response.json()) as { data: { questions: { prompt: string; answers: { answer: string; tier: string }[] }[] } };
  const firstQuestion = data.questions.find((item) => item.prompt === prompt)!;
  const answer = firstQuestion.answers[0];
  await page.getByRole("textbox", { name: "Your answer" }).fill(answer.answer);
  await page.getByRole("button", { name: /^Dive/ }).click();
  await expect(page.getByText("Endless · Prompt 2")).toBeVisible();
  await expect(page.locator(".question-category")).toHaveText("Mathematics");
  await page.reload();
  await expect(page.getByText("Endless · Prompt 2")).toBeVisible();
  await expect(page.getByText("Review accepted answers")).toHaveCount(0);
  await page.getByRole("button", { name: "Finish dive" }).click();
  await page.getByText("Review accepted answers").click();
  await page.getByText(`1. ${prompt}`, { exact: true }).click();
  const table = page.getByRole("table", { name: "Accepted answers for prompt 1" });
  await expect(table.getByRole("row")).toHaveCount(firstQuestion.answers.length + 1);
  await expect(table.getByRole("row").filter({ has: page.getByRole("cell", { name: answer.answer, exact: true }) }).locator(`.tier-${answer.tier}`)).toBeVisible();
});

test("players create a room, join by code, and see the same timed prompt", async ({ page, browser }) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /think deeper/i })).toBeVisible();
  await expect(page.locator(".surface-menu .pixel-shoreline")).toBeInViewport();
  const shore = page.locator(".surface-menu .pixel-shoreline");
  await expect.poll(() => shore.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      scaled: canvas.width === Math.ceil(canvas.clientWidth / 3) && getComputedStyle(canvas).imageRendering === "pixelated",
      filled: pixels.some((value, index) => index % 4 === 3 && value === 255),
      blended: pixels.some((value, index) => index % 4 === 3 && value > 0 && value < 255),
    };
  })).toEqual({ scaled: true, filled: true, blended: false });
  const wildlife = page.locator(".surface-menu .ocean-wildlife").first();
  const firstFrame = await wildlife.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await expect.poll(() => wildlife.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).not.toBe(firstFrame);
  await page.getByRole("link", { name: /sign in to dive/i }).click();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("user");
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.getByRole("button", { name: /create room/i }).click();
  await expect(page.getByText("Private room")).toBeVisible();
  await expect(page.locator(".surface-lobby .pixel-shoreline")).toBeInViewport();
  const code = await page.locator(".room-code").innerText();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await signIn(guest, "admin", "admin");
  guest.on("pageerror", (error) => consoleErrors.push(error.message));
  guest.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  guest.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await guest.getByLabel("Room code").fill(code);
  await guest.getByRole("button", { name: "Join room" }).click();
  await expect(guest.getByText("On this dive · 2")).toBeVisible();
  await expect(page.getByText("On this dive · 2")).toBeVisible();
  await guest.getByRole("link", { name: "Profile" }).click();
  await expect(guest.getByRole("heading", { name: "Skins" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Stats" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Elo" })).toBeVisible();
  await guest.getByRole("button", { name: "Menu" }).click();
  await guest.getByRole("link", { name: "Dive", exact: true }).click();
  await expect(guest.locator(".room-code")).toHaveText(code);

  await page.getByRole("button", { name: /begin descent/i }).click();
  await expect(page.getByText("Prompt 1 of 7")).toBeVisible();
  await expect(guest.getByText("Prompt 1 of 7")).toBeVisible();
  for (const username of ["user", "admin"]) {
    const player = (tab: Page) => tab.locator(".diving-krill").filter({ hasText: username });
    await expect(player(page)).toHaveCount(1);
    await expect(player(guest)).toHaveCount(1);
    const position = await player(page).evaluate((element) => (element as HTMLElement).style.left);
    expect(await player(guest).evaluate((element) => (element as HTMLElement).style.left)).toBe(position);
  }
  await expect(page.locator(".ocean-sky .pixel-shoreline")).toBeInViewport();
  const question = page.locator(".question-panel h2");
  const prompt = await question.innerText();
  await expect(guest.locator(".question-panel h2")).toHaveText(prompt);
  await guest.reload();
  await expect(guest.getByText("Prompt 1 of 7")).toBeVisible();
  await expect(guest.locator(".question-panel h2")).toHaveText(prompt);

  const byPrompt = await guest.request.post(new URL("/api/game/questions/list", guest.url()).href);
  expect(byPrompt.ok()).toBeTruthy();
  const { data } = (await byPrompt.json()) as { data: { questions: { prompt: string; answers: { answer: string }[] }[] } };
  const accepted = data.questions.find((item) => item.prompt === prompt)?.answers[0]?.answer;
  expect(accepted).toBeTruthy();
  const sky = page.locator(".ocean-sky");
  const hudTop = (await question.boundingBox())!.y;
  const skyTop = (await sky.boundingBox())!.y;
  await expect(page.locator(".descent-scene")).toBeInViewport({ ratio: 0.99 });
  await expect(page.getByRole("textbox", { name: "Your answer" })).toBeInViewport();
  await expect(page.getByRole("timer")).toBeInViewport();
  await page.getByRole("textbox", { name: "Your answer" }).fill(accepted!);
  await page.getByRole("button", { name: /dive/i }).click();
  await expect(page.getByText("Dive recorded")).toBeInViewport();
  await expect.poll(async () => (await sky.boundingBox())!.y).toBeLessThan(skyTop - 10);
  expect((await question.boundingBox())!.y).toBeCloseTo(hudTop, 0);
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
  await guestContext.close();
});

test("admin can add and remove a prompt", async ({ page }) => {
  await signIn(page, "admin", "admin");
  await page.goto("/admin");
  const search = page.getByRole("searchbox", { name: "Search questions" });
  await search.fill("Jupietr moon");
  await expect(page.getByRole("heading", { name: "Name a moon of Jupiter." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Name a type of pasta." })).toHaveCount(0);
  await search.clear();
  await page.getByLabel("Filter by category").selectOption("Space");
  await expect(page.getByRole("heading", { name: "Name a moon of Jupiter." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Name a type of pasta." })).toHaveCount(0);
  const prompt = `Browser test prompt ${Date.now()}`;
  await page.getByLabel("Question prompt").fill(prompt);
  await page.getByLabel("Category", { exact: true }).fill("Space");
  await page.getByLabel("Accepted answers").fill(Array.from({ length: 15 }, (_, index) => `plankton | Answer ${index + 1}`).join("\n"));
  await page.getByRole("button", { name: "Add question" }).click();
  const card = page.locator(".question-card").filter({ hasText: prompt });
  await expect(card).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);

  const username = `diver${Date.now()}`;
  await page.getByLabel("Username", { selector: "input" }).fill(username);
  await page.getByLabel("Temporary password").fill("deep-ocean-pass");
  await page.getByRole("button", { name: "Create player account" }).click();
  await expect(page.getByText(username, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${username} Player` }).click();
  const profile = page.getByRole("region", { name: `${username}'s profile` });
  await expect(profile.getByText("1,000 Elo")).toBeVisible();
  await expect(profile.getByText(/0 completed dives/)).toBeVisible();
  await expect(profile.getByRole("heading", { name: "Skins" })).toBeVisible();
  await page.getByRole("button", { name: "admin Admin", exact: true }).click();
  await expect(page.getByRole("region", { name: "admin's profile" }).getByText("50,000 Elo")).toBeVisible();
});

test("session refresh restores sign-in and regular users cannot open the question editor", async ({ page, context }) => {
  await signIn(page, "user", "user");
  const cookies = await context.cookies();
  const refreshCookie = cookies.find((cookie) => cookie.name === "template_refresh");
  expect(cookies.find((cookie) => cookie.name === "template_access")).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  expect(refreshCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/api/auth" });
  await context.clearCookies({ name: "template_access" });
  await page.reload();
  await expect(page.getByRole("heading", { name: /ready to dive/i })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === "template_refresh")?.value).not.toBe(refreshCookie?.value);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /ready to dive/i })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
});

test("unknown address shows the not found page", async ({ page }) => {
  await page.goto("/unknown-game-mode");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to home page" }).click();
  await expect(page).toHaveURL("/");
});

test("online queues, Ranked reconnect and earned skins", async ({ page, browser }) => {
  await signIn(page, "admin", "admin");
  const unlockApi = "/api/game/profile/equip";
  expect((await page.request.post(unlockApi, { data: { skin: "arakelov" } })).status()).toBe(403);

  await page.getByRole("button", { name: "Play endless" }).click();
  await expect(page.getByText("Endless · Prompt 1")).toBeVisible();
  const firstPrompt = await page.locator(".question-panel h2").innerText();
  const bank = await page.request.post("/api/game/questions/list");
  const { data } = (await bank.json()) as { data: { questions: { prompt: string; answers: { answer: string }[] }[] } };
  const firstAnswer = data.questions.find((question) => question.prompt === firstPrompt)!.answers[0].answer;
  await page.getByRole("textbox", { name: "Your answer" }).fill(firstAnswer);
  await page.getByRole("button", { name: /^Dive/ }).click();
  await expect(page.getByText("Dive recorded")).toBeVisible();
  await page.getByRole("button", { name: "Finish dive" }).click();
  await page.getByRole("button", { name: "Back to lobby" }).click();
  await page.goto("/profile");
  await expect(page.getByText("50,000 Elo", { exact: true })).toBeVisible();
  await expect(page.locator('.rank-badge[data-rank="50000"]')).toHaveText("Abyss Architect");
  await expect(page.locator('.skin-card [data-skin="admin_aurora"] img')).toHaveAttribute("src", "/skins/admin_aurora.png");
  await page.getByRole("button", { name: "Equip Sunbleached" }).click();
  await expect(page.getByText("Answer ??? for ???", { exact: true })).toHaveCount(6);
  const secretSkin = page.locator(".skin-card").filter({ hasText: "Arithmetic Ghost" });
  await expect(secretSkin).toContainText("Answer ??? for ???");
  await expect(secretSkin).toHaveAttribute("data-locked", "true");
  await expect(secretSkin.getByRole("button", { name: "Equip Arithmetic Ghost" })).toHaveCount(0);
  await expect(page.getByText(/Arakelov theory/)).toHaveCount(0);
  await expect(secretSkin.locator('img[src="/skins/arakelov.png"]')).toHaveCount(1);
  await expect(page.locator(".skin-card").filter({ hasText: "Sunbleached" })).toContainText("Equipped");
  await page.reload();
  await expect(page.locator(".skin-card").filter({ hasText: "Sunbleached" })).toContainText("Equipped");

  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext()));
  try {
    const divers = await Promise.all(contexts.map((context) => context.newPage()));
    for (const [index, diver] of divers.entries()) {
      const username = `queue${Date.now()}${index}`;
      const response = await page.request.post("/api/admin/users/create", { data: { username, password: "test-password" } });
      expect(response.ok()).toBeTruthy();
      await signIn(diver, username, "test-password");
    }

    await page.goto("/");
    await page.getByRole("button", { name: "Casual Online" }).click();
    await expect(page.getByText(/Searching for a Casual match/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel queue" }).click();
    await expect(page.getByText(/Searching for a Casual match/)).toHaveCount(0);
    await Promise.all([page, ...divers].map((diver) => diver.getByRole("button", { name: "Casual Online" }).click()));
    await expect(divers[0].locator(".diving-krill")).toHaveCount(4);
    const equippedSprite = divers[0].locator('.diving-krill [data-skin="first"] img');
    await expect(equippedSprite).toHaveAttribute("src", "/skins/first.png");
    await expect.poll(() => equippedSprite.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(52);
    for (const diver of divers) await diver.getByRole("button", { name: "Leave match" }).click();
    const [rankedWinner, rankedLoser] = divers;
    for (const player of [rankedWinner, rankedLoser]) {
      await player.getByRole("button", { name: "Back to lobby" }).click();
    }
    await rankedWinner.getByRole("button", { name: "Ranked 1v1" }).click();
    await expect(rankedWinner.getByText(/Searching for a Ranked match/)).toBeVisible();
    await rankedWinner.reload();
    await expect(rankedWinner.getByText(/Searching for a Ranked match/)).toBeVisible();
    await rankedLoser.getByRole("button", { name: "Ranked 1v1" }).click();
    await expect(rankedWinner.locator(".diving-krill")).toHaveCount(2);
    const prompt = await rankedWinner.locator(".question-panel h2").innerText();
    await rankedWinner.reload();
    await expect(rankedWinner.locator(".question-panel h2")).toHaveText(prompt);
    rankedLoser.once("dialog", (dialog) => dialog.accept());
    await rankedLoser.getByRole("button", { name: "Leave match" }).click();
    const elo = rankedWinner.getByRole("list", { name: "Ranked Elo changes" });
    await expect(elo).toContainText("1000 → 1016 Elo (+16)");
    await expect(elo).toContainText("1000 → 984 Elo (-16)");
    await rankedWinner.goto("/profile");
    await expect(rankedWinner.getByText("1,016 Elo")).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
