import { expect, test, type Page } from "@playwright/test";

const FAMILIARS = [
  { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "codex", icon: "ph:sparkle-fill" },
  { id: "cody", display_name: "Cody", role: "Code familiar", status: "active", harness: "codex", icon: "ph:code-bold" },
];
const PROJECT = { id: "p1", name: "Cave", root: "/repo/cave", access: "write" };
const SESSIONS = [{
  id: "entry-recent",
  title: "Polish the chat experience",
  familiarId: "nova",
  project_root: PROJECT.root,
  harness: "codex",
  status: "idle",
  hasLocalConversation: true,
  archived_at: null,
  created_at: "2026-09-01T12:00:00.000Z",
  updated_at: "2026-09-01T12:00:00.000Z",
}];

async function seed(page: Page, active = true) {
  await page.addInitScript((hasActive) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("p1"));
    if (hasActive) localStorage.setItem("cave:active-familiar", "nova");
  }, active);
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: FAMILIARS } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [PROJECT] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: SESSIONS } }));
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route("**/api/github/review-requests**", (route) => route.fulfill({ json: { ok: true, rows: [] } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: { ok: true, conversation: { turns: [] }, context: { task: null, github: [] } },
  }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({
    json: { ok: true, state: {
      familiarId: "nova", runtime: null, harness: "codex", effectiveModel: "unknown",
      source: "runtime-default", applicationState: "saved", reason: "e2e",
    } },
  }));
}

test("Home names Chat and Task actions and preserves the draft across selection and reload", async ({ page }) => {
  await seed(page);
  await page.goto("/?mode=home");
  const home = page.locator(".home-composer-root");
  const message = home.getByRole("textbox", { name: "Chat message" });
  await expect(message).toBeVisible();
  await message.fill("Keep this brief while I choose where it goes");
  await expect(home.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await home.getByRole("radio", { name: "Task", exact: true }).click();
  await expect(home.getByRole("textbox", { name: "Task description" })).toHaveValue("Keep this brief while I choose where it goes");
  await expect(home.getByRole("button", { name: "Create task", exact: true })).toBeEnabled();
  await expect(home.locator(".home-composer-guidance")).toContainText("add to Tasks");
  await home.getByRole("radio", { name: "Chat", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cave:home-composer-draft:v1"))).toContain("Keep this brief");
  await page.reload();
  await expect(message).toHaveValue("Keep this brief while I choose where it goes");
  await expect(message).toHaveAccessibleDescription("Choose a familiar and describe what you want to work on.");
});

test("Home creates a task with the chosen familiar and project", async ({ page }) => {
  await seed(page);
  let created: Record<string, unknown> | null = null;
  await page.route("**/api/board", (route) => {
    if (route.request().method() === "POST") {
      created = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true, card: { id: "entry-task" } } });
    }
    return route.fulfill({ json: { ok: true, cards: [] } });
  });
  await page.goto("/?mode=home");
  const home = page.locator(".home-composer-root");
  await home.getByRole("radio", { name: "Task", exact: true }).click();
  await home.getByRole("textbox", { name: "Task description" }).fill("Refine the first message");
  await home.getByRole("button", { name: "Create task", exact: true }).click();
  await expect.poll(() => created).toMatchObject({
    title: "Refine the first message", familiarId: "nova", projectId: "p1", cwd: PROJECT.root,
  });
});

test("Home sends its brief to the chosen familiar and project", async ({ page }) => {
  await seed(page);
  const sends: Record<string, unknown>[] = [];
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({ kind: "assistant_chunk", text: "Ready." })}`, "",
        `data: ${JSON.stringify({ kind: "done", sessionId: "entry-sent" })}`, "", "",
      ].join("\n"),
    });
  });
  await page.goto("/?mode=home");
  const home = page.locator(".home-composer-root");
  await home.getByRole("textbox", { name: "Chat message" }).fill("Refine the first message");
  await home.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({
    prompt: "Refine the first message", familiarId: "nova", projectRoot: PROJECT.root,
  });
});

test("new chat keeps the composer, project default and existing work reachable in narrow short panes", async ({ page }, testInfo) => {
  await seed(page);
  await page.goto("/?mode=chat");
  const dash = page.getByTestId("chat-main").getByTestId("chat-new-dashboard");
  await expect(dash).toBeVisible();
  await expect(dash.locator(".cave-sf")).toBeVisible();
  await page.setViewportSize({ width: 600, height: 540 });
  const input = dash.locator("textarea").first();
  await input.fill("A longer brief\nwith multiple lines\nthat must not cover existing work.");
  const composer = dash.locator(".home-dash__composer");
  const work = dash.locator(".cave-sf");
  const composerBox = await composer.boundingBox();
  const workBox = await work.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(workBox).not.toBeNull();
  expect(workBox!.y).toBeGreaterThanOrEqual(composerBox!.y + composerBox!.height);
  const defaults = dash.getByRole("button", { name: "Use project by default" });
  await defaults.scrollIntoViewIfNeeded();
  await expect(defaults).toBeInViewport();
  await defaults.focus();
  await expect(defaults).toBeFocused();
  expect(await defaults.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await expect(dash.locator(".home-dash__eyebrow")).toContainText("New chat · Nova");
  expect(await input.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe("none");
  await work.scrollIntoViewIfNeeded();
  await expect(work).toBeInViewport();
  await expect(work).toContainText("Resume a chat, open a task, or start a follow-up.");
  const dock = dash.locator(".home-dash__composer .cave-composer-dock");
  await dock.evaluate((element) => element.style.setProperty("--composer-kb-offset", "300px"));
  await expect(dock).toHaveCSS("transform", "none");
  await input.scrollIntoViewIfNeeded();
  await expect(input).toBeInViewport();
  await testInfo.attach("narrow-new-chat", { body: await page.screenshot(), contentType: "image/png" });
});

test("no-familiar launch asks rather than silently selecting an actor", async ({ page }, testInfo) => {
  await seed(page, false);
  await page.goto("/?mode=chat");
  const launch = page.locator(".cave-launch").first();
  await expect(launch).toBeVisible();
  await expect(launch).toContainText("You can write your message next.");
  await page.screenshot({ path: testInfo.outputPath("choose-familiar.png") });
  const choose = launch.getByRole("button", { name: "Choose familiar", exact: true });
  await choose.focus();
  await expect(choose).toBeFocused();
  await page.keyboard.press("Enter");
  const gate = page.getByRole("dialog", { name: /Choose familiar/ });
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Cody", exact: true }).click();
  await expect(page.getByTestId("chat-main").locator(".home-dash__eyebrow")).toContainText("New chat · Cody");
});

for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]] as const) {
  test(`chat entry surfaces fit and render in ${theme} ${mode}`, async ({ page }, testInfo) => {
    await seed(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const surface of ["home", "chat"]) {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`/?mode=${surface}`);
      const entry = surface === "home"
        ? page.locator(".home-composer-root")
        : page.getByTestId("chat-main").getByTestId("chat-new-dashboard");
      await expect(entry).toBeVisible();
      await page.evaluate(({ theme, mode }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.mode = mode;
      }, { theme, mode });
      await expect(entry.locator("textarea").first()).toBeVisible();
      expect(await entry.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const path = testInfo.outputPath(`${surface}-${theme}-${mode}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`${surface}-${theme}-${mode}`, { path, contentType: "image/png" });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await entry.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${surface}-${theme}-${mode}-narrow.png`) });
    }
  });
}
