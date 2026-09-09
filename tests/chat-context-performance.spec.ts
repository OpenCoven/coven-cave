import { expect, test, type Page } from "@playwright/test";

const now = new Date().toISOString();
const familiars = [
  { id: "cody", display_name: "Cody", role: "Code Familiar", status: "active", icon: "ph:code" },
  { id: "sage", display_name: "Sage", role: "Research Familiar", status: "active", icon: "ph:book-open" },
];
const projects = ["alpha", "beta"].map((id) => ({
  id, name: `Context ${id}`, root: `/context/${id}`, access: "write", createdAt: now, updatedAt: now,
}));
const sessions = [
  { id: "context-a", familiarId: "cody", project_root: "/context/alpha", title: "Context thread A" },
  { id: "context-b", familiarId: "cody", project_root: "/context/beta", title: "Context thread B" },
].map((session) => ({
  ...session, status: "completed", origin: "chat", harness: "codex", exit_code: null,
  archived_at: null, created_at: now, updated_at: now,
  attention: { state: "none", since: null, reason: null },
}));

async function setup(page: Page, betaFamiliar = "cody", pendingSessions?: Promise<void>) {
  const conversationRequests: string[] = [];
  await page.context().routeWebSocket("**/*", (socket) => socket.close());
  await page.addInitScript((betaFamiliar) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:shell:nav-open", "1");
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1",
      JSON.stringify({ "__all-projects__": ["cody"], alpha: ["cody"], beta: [betaFamiliar] }));
  }, betaFamiliar);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      await route.fulfill({ status: 403, json: { ok: false, error: "Fixture forbids live mutations" } });
      return;
    }
    let payload: object = { ok: true };
    if (url.pathname === "/api/familiars") payload = { ok: true, familiars };
    else if (url.pathname === "/api/projects") payload = { ok: true, projects };
    else if (url.pathname === "/api/sessions/list") {
      if (pendingSessions) await pendingSessions;
      payload = { ok: true, sessions: pendingSessions ? sessions.map((session) => ({
        ...session, updated_at: session.id === "context-b" ? new Date(Date.parse(now) + 1_000).toISOString() : now,
      })) : sessions };
    }
    else if (url.pathname === "/api/queue/project") payload = { ok: true, projectId: "alpha", project: projects[0] };
    else if (url.pathname === "/api/daemon/connection") payload = { ok: true, connected: true, running: true, target: { mode: "local" } };
    else if (url.pathname === "/api/board") payload = { ok: true, cards: [] };
    else if (url.pathname === "/api/inbox") payload = { ok: true, items: [] };
    else if (url.pathname === "/api/github/tasks") payload = { ok: true, tasks: [] };
    else if (url.pathname.startsWith("/api/chat/conversation/")) {
      const id = url.pathname.split("/").at(-1)!;
      conversationRequests.push(id);
      const turns = Array.from({ length: 1_000 }, (_, index) => ({
        id: `${id}-${index}`, parentId: index ? `${id}-${index - 1}` : null,
        role: index % 2 ? "assistant" : "user",
        text: `${id} message ${index}. ${index === 0 ? "Only oldest needle." : "A synthetic transcript turn."}`,
        createdAt: now,
      }));
      payload = { ok: true, conversation: { id, turns, activeLeafId: turns.at(-1)!.id }, context: null };
    }
    await route.fulfill({ json: payload });
  });
  await page.goto("/?mode=chat");
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 30_000 });
  if (!pendingSessions) {
    await expect(page.locator(".cnav__thread-main").filter({ hasText: "Context thread A" }).first()).toBeVisible();
  }
  return conversationRequests;
}

async function openThread(page: Page, letter: "A" | "B") {
  await page.locator(".cnav__thread-main").filter({ hasText: `Context thread ${letter}` }).first().click();
  await expect(page.getByTestId("chat-main").locator(`[data-turn-id="context-${letter.toLowerCase()}-999"]`)).toBeAttached();
}

async function switchProject(page: Page, projectId: "alpha" | "beta") {
  const switcher = page.locator(".workspace-context-switcher:visible").first();
  await switcher.getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: `Context ${projectId}` }).first().locator(".ui-popover-item").click();
}

test("reselecting the composer project preserves its draft across global and local selections", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Alt+2");
  await switchProject(page, "alpha");
  const main = page.getByTestId("chat-main");
  const composer = main.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Alpha draft remains Alpha");
  await main.getByRole("button", { name: /^Project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: "Context alpha" }).first().locator(".ui-popover-item").click();
  await expect(composer).toHaveValue("Alpha draft remains Alpha");
  await main.getByRole("button", { name: /^Project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: "Context beta" }).first().locator(".ui-popover-item").click();
  await expect(composer).toHaveValue("");
  await composer.fill("Beta stays separate");
  await main.getByRole("button", { name: /^Project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: "Context alpha" }).first().locator(".ui-popover-item").click();
  await expect(composer).toHaveValue("Alpha draft remains Alpha");
  await switchProject(page, "beta");
  await expect(composer).toHaveValue("Beta stays separate");
  await switchProject(page, "alpha");
  await expect(composer).toHaveValue("Alpha draft remains Alpha");
});

for (const clearFirst of [false, true]) {
  test(clearFirst
    ? "an explicit clear still fences pending history after a later informational command"
    : "informational commands do not suppress a pending conversation history load", async ({ page }) => {
    await setup(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/chat/conversation/context-a", async (route) => {
      await pending;
      await route.fallback();
    });
    try {
      await page.locator(".cnav__thread-main").filter({ hasText: "Context thread A" }).first().click();
      const main = page.getByTestId("chat-main");
      const composer = main.getByRole("textbox", { name: "Message", exact: true });
      if (clearFirst) {
        await composer.fill("/clear");
        await composer.press("Enter");
        await expect(composer).toHaveValue("");
      }
      await composer.fill("/help");
      await composer.press("Enter");
      await expect(main.locator("[data-turn-id]")).toHaveCount(1);
      const response = page.waitForResponse((response) => response.url().endsWith("/api/chat/conversation/context-a"));
      release();
      await response;
      if (clearFirst) {
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(main.locator("[data-turn-id]")).toHaveCount(1);
      } else {
        await expect(main.locator('[data-turn-id="context-a-999"]')).toBeAttached();
      }
      await expect(main.locator("[data-turn-id]").filter({ hasText: "/help" })).toHaveCount(1);
    } finally {
      release();
    }
  });
}

test("explicit familiar selection navigates even when project browsing already selected it", async ({ page }) => {
  await setup(page, "sage");
  await openThread(page, "A");
  await switchProject(page, "beta");
  const main = page.getByTestId("chat-main");
  await expect(main.locator('[data-turn-id="context-a-999"]')).toBeAttached();
  const switcher = page.locator(".workspace-context-switcher:visible").first();
  await expect(switcher.getByRole("button", { name: /^Switch familiar/ })).toContainText("Sage");
  await switcher.getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("dialog", { name: "Familiars", exact: true }).getByRole("option").filter({ hasText: "Sage" }).click();
  await expect(main.getByRole("textbox", { name: "Message", exact: true })).toHaveAttribute("placeholder", "Message Sage…");
  await expect(main.locator("[data-turn-id]")).toHaveCount(0);
  const composer = main.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Sage draft survives reselection");
  await switcher.getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("dialog", { name: "Familiars", exact: true }).getByRole("option").filter({ hasText: "Sage" }).click();
  await expect(composer).toHaveValue("Sage draft survives reselection");
});

test("palette familiar selection opens a composer from the Projects tab", async ({ page }) => {
  await setup(page);
  await page.locator(".chat-surface").getByRole("tab", { name: "Projects", exact: true }).click();
  await expect(page.getByTestId("chat-main")).not.toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.getByPlaceholder("Search Cave…").fill("Cody");
  await page.getByRole("option").filter({ hasText: "Code Familiar" }).click();
  const main = page.getByTestId("chat-main");
  await expect(main.getByRole("textbox", { name: "Message", exact: true })).toHaveAttribute("placeholder", "Message Cody…");
  await expect(main.locator("[data-turn-id]")).toHaveCount(0);
});

test("project browsing filters the rail without rebinding the open conversation or its draft", async ({ page }) => {
  await setup(page);
  await openThread(page, "B");
  const composer = page.getByTestId("chat-main").locator("textarea").first();
  await composer.fill("Draft only for B");
  await openThread(page, "A");
  await expect(composer).toHaveValue("");
  await composer.fill("Draft only for A");
  await openThread(page, "B");
  await expect(composer).toHaveValue("Draft only for B");

  await switchProject(page, "alpha");
  await expect(page.locator(".chat-inner-rail .cnav__thread-title")).toHaveText(["Context thread A"]);
  await expect(composer).toHaveValue("Draft only for B");
  await expect(page.getByTestId("chat-main").locator('[data-turn-id="context-b-999"]')).toBeAttached();
  await page.screenshot({ path: test.info().outputPath("project-browse.png") });

  await page.keyboard.press("Alt+2");
  await expect(composer).toHaveValue("");
  await expect(page.getByTestId("chat-main").locator("[data-turn-id]")).toHaveCount(0);
});

test("rail intent prefetch and full-history find never require mounting the whole transcript", async ({ page }) => {
  const requests = await setup(page);
  await page.locator(".cnav__thread-main").filter({ hasText: "Context thread A" }).first().hover();
  await expect.poll(() => requests.includes("context-a")).toBe(true);
  await openThread(page, "A");
  const main = page.getByTestId("chat-main");
  await main.locator(".cave-chat-fold__trigger").click();
  expect(await main.locator("[data-turn-id]").count()).toBeLessThanOrEqual(60);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await page.getByPlaceholder("Find in chat…").fill("Only oldest needle");
  await expect(main.locator('[data-turn-id="context-a-0"]')).toBeVisible();
  expect(await main.locator("[data-turn-id]").count()).toBeLessThanOrEqual(60);
  await page.getByPlaceholder("Find in chat…").fill("context-a message");
  await expect(page.locator(".cave-find-band__count")).toHaveText("1/1000");
  await expect(page.locator(".cave-find-hit")).toHaveCount(40);
  expect(await main.locator("[data-turn-id]").count()).toBeLessThanOrEqual(60);
  await page.getByRole("button", { name: "Close find", exact: true }).click();
  await main.locator(".cave-chat-transcript").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(main.locator('[data-turn-id="context-a-0"]')).toBeAttached();
  await expect(main.locator('[data-turn-id="context-a-999"]')).toHaveCount(0);
  await main.getByRole("button", { name: "Show newer turns", exact: true }).click();
  await expect(main.locator('[data-turn-id="context-a-54"]')).toBeAttached();
  await expect(main.locator('[data-turn-id="context-a-0"]')).toHaveCount(0);
});

test("slash completion uses the current draft after navigating between threads", async ({ page }) => {
  await setup(page);
  await openThread(page, "A");
  await openThread(page, "B");
  const composer = page.getByTestId("chat-main").locator("textarea").first();
  await composer.fill("/hel");
  await composer.press("Tab");
  await expect(composer).toHaveValue(/^\/help\s*$/);
});

test("blank project drafts stay isolated and first-send context freezes before session creation", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Alt+2");
  const main = page.getByTestId("chat-main");
  const composer = main.locator("textarea").first();
  await switchProject(page, "alpha");
  await composer.fill("Alpha only");
  await switchProject(page, "beta");
  await expect(composer).toHaveValue("");
  await composer.fill("Beta only");
  await switchProject(page, "alpha");
  await expect(composer).toHaveValue("Alpha only");

  const roots: string[] = [];
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/chat/send", async (route) => {
    roots.push(route.request().postDataJSON().projectRoot);
    await pending;
    await route.fulfill({ status: 400, json: { ok: false, error: "Synthetic send stopped; no live mutation" } });
  });

  try {
    await composer.press("Enter");
    await expect.poll(() => roots.length).toBe(1);
    expect(roots).toEqual(["/context/alpha"]);
    await composer.fill("Follow-up for Alpha");
    await switchProject(page, "beta");
    await expect(composer).toHaveValue("Follow-up for Alpha");
    expect(roots).toEqual(["/context/alpha"]);
  } finally {
    finish();
  }
});

test("late session recency cannot move an inferred first-send project or its promotion draft", async ({ page }) => {
  let releaseSessions!: () => void;
  const pendingSessions = new Promise<void>((resolve) => { releaseSessions = resolve; });
  let releaseSend!: () => void;
  const pendingSend = new Promise<void>((resolve) => { releaseSend = resolve; });
  const roots: string[] = [];
  await setup(page, "cody", pendingSessions);
  const switcher = page.locator(".workspace-context-switcher:visible").first();
  await switcher.getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".ui-popover-item").filter({ hasText: /^All projects$/ }).click();
  await expect(switcher.getByRole("button", { name: /^Switch project:/ })).toContainText("All projects");
  await page.route("**/api/chat/send", async (route) => {
    roots.push(route.request().postDataJSON().projectRoot);
    await pendingSend;
    await route.fulfill({
      contentType: "text/event-stream",
      body: [
        { kind: "session", sessionId: "inferred-alpha" },
        { kind: "done", sessionId: "inferred-alpha" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  try {
    const main = page.getByTestId("chat-main");
    const composer = main.getByRole("textbox", { name: "Message", exact: true });
    await expect(main.getByRole("button", { name: /^Project:/ })).toContainText("Context alpha");
    await composer.fill("Send from inferred Alpha");
    await composer.press("Enter");
    await expect.poll(() => roots).toEqual(["/context/alpha"]);
    await composer.fill("Inferred Alpha follow-up");
    releaseSessions();
    await expect(page.locator(".cnav__thread-main").filter({ hasText: "Context thread B" }).first()).toBeVisible();
    await expect(composer).toHaveValue("Inferred Alpha follow-up");
    await expect(main.getByRole("button", { name: /^Project:/ })).toContainText("Context alpha");
    releaseSend();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#chat-inferred-alpha");
    await expect(composer).toHaveValue("Inferred Alpha follow-up");
  } finally {
    releaseSessions();
    releaseSend();
  }
});

test("a remote-host handoff carries follow-up text through its owned session promotion", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    localStorage.setItem(
      `cave:chat-composer-draft:v1:scoped:${JSON.stringify(["compose", "cody", "/context/alpha", "builder"])}`,
      "Restored remote draft",
    );
  });
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const hosts: string[] = [];
  await page.route("**/api/chat/send", async (route) => {
    hosts.push(route.request().postDataJSON().runtimeHost);
    await pending;
    await route.fulfill({
      contentType: "text/event-stream",
      body: [
        { kind: "session", sessionId: "remote-handoff" },
        { kind: "done", sessionId: "remote-handoff" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", {
      detail: {
        familiarId: "cody", projectRoot: "/context/alpha", initialPrompt: "Synthetic remote handoff",
        initialControls: { runtimeHost: "builder" },
      },
    })));
    await expect.poll(() => hosts).toEqual(["builder"]);
    const composer = page.getByTestId("chat-main").locator("textarea").first();
    await expect(composer).toHaveValue("Restored remote draft");
    await composer.fill("Remote follow-up");
    release();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#chat-remote-handoff");
    await expect(composer).toHaveValue("Remote follow-up");
  } finally {
    release();
  }
});
