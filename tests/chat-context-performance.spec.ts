import { expect, test } from "@playwright/test";
import { now, setup, openThread, switchProject } from "./chat-context-fixture";

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
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    // Install the history gate before boot: shell prefetch can otherwise fill
    // the conversation cache before a later route override starts delaying it.
    await setup(page, "cody", undefined, pending);
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
      const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/chat/conversation/context-a");
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
  // The project filter lists only Alpha's thread; the still-open Beta thread
  // stays reachable in its own "Outside this project" section (#5585).
  const outside = page.locator('.chat-inner-rail section[aria-label="Open chat outside this project"]');
  const filteredTitles = page.locator('.chat-inner-rail section:not([aria-label="Open chat outside this project"]) .cnav__thread-title');
  await expect(filteredTitles).toHaveCount(1);
  await expect(filteredTitles).toHaveAttribute("title", "Context thread A");
  await expect(outside.locator(".cnav__thread-title")).toHaveAttribute("title", "Context thread B");
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

test("Escape closes find from its controls, results and paging without losing composer focus", async ({ page }) => {
  await setup(page);
  await openThread(page, "A");
  const main = page.getByTestId("chat-main");
  const composer = main.getByRole("textbox", { name: "Message", exact: true });
  const search = main.getByRole("search", { name: "Find in conversation" });
  // A staged reply keeps the composer mounted while Find jumps into history.
  // An empty composer intentionally releases its space when reading old turns.
  await composer.fill("Keep this reply while searching");
  for (const target of ["toggle", "result", "page"] as const) {
    await composer.focus();
    await composer.press("ControlOrMeta+f");
    await search.getByRole("textbox", { name: "Find in conversation" }).fill("context-a message");
    await expect(search.locator(".cave-find-hit")).toHaveCount(40);
    const control = target === "toggle" ? search.getByRole("button", { name: "Match case", exact: true })
      : target === "result" ? search.locator(".cave-find-hit").first()
        : search.getByRole("button", { name: "Later matches", exact: true });
    await control.focus();
    await control.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Keep this reply while searching");
    await expect(main.locator('[data-turn-id="context-a-0"]')).toBeAttached();
  }
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

for (const departure of ["project", "new-chat"] as const) {
  test(`a delayed runtime save cannot send or move a draft after ${departure} departure`, async ({ page }) => {
    await setup(page);
    await switchProject(page, "alpha");
    const priorComposer = await page.getByTestId("chat-main").getByRole("textbox", { name: "Message", exact: true }).elementHandle();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", {
      detail: { familiarId: "cody", projectRoot: "/context/alpha" },
    })));
    // New Chat awaits project/familiar admission before replacing its composer.
    // The old composer can already show Alpha, so the chip alone cannot prove
    // the request finished. Begin the runtime-save scenario in the new instance.
    await expect.poll(() => priorComposer!.evaluate((element) => element.isConnected)).toBe(false);
    await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context alpha/ })).toBeVisible();
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let saves = 0;
    let sends = 0;
    await page.route("**/api/config", async (route) => {
      saves += 1;
      await saveGate;
      await route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: {
      ok: true, state: { harness: "claude", effectiveModel: "", source: "runtime-default", applicationState: "saved", reason: "fixture" },
    } }));
    await page.route("**/api/chat/send", (route) => {
      sends += 1;
      return route.fulfill({ status: 403, json: { ok: false, error: "Synthetic send forbidden" } });
    });
    const main = page.getByTestId("chat-main");
    const composer = main.getByRole("textbox", { name: "Message", exact: true });
    await composer.fill("Origin message waiting for runtime");
    await main.getByRole("button", { name: /change runtime/ }).click();
    await page.getByRole("menu", { name: "Runtime", exact: true }).getByRole("menuitemradio", { name: "Codex", exact: true }).click();
    await expect.poll(() => saves).toBe(1);
    await page.keyboard.press("Escape");
    await composer.focus();
    await expect(composer).toHaveValue("Origin message waiting for runtime");
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    // The draft clearing alone can precede the committed send render. Confirm
    // the origin submission was recorded before replacing its ChatView.
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("cave:chat-composer-history:v1") ?? "[]"),
    )).toContain("Origin message waiting for runtime");
    try {
      if (departure === "project") {
        await main.getByRole("button", { name: /^Project:/ }).click();
        await page.locator(".cave-project-picker__row").filter({ hasText: "Context beta" }).first().locator(".ui-popover-item").click();
      } else {
        const oldComposer = await composer.elementHandle();
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", { detail: { familiarId: "cody" } })));
        await expect.poll(() => oldComposer!.evaluate((element) => element.isConnected)).toBe(false);
      }
      await composer.fill("Destination draft must survive");
      await expect.poll(() => page.evaluate(() => Object.values(localStorage).includes("Destination draft must survive"))).toBe(true);
      // Live-region messages clear after 250ms. Record the DOM mutation before
      // releasing the save rather than racing Playwright's polling interval.
      await page.evaluate(() => {
        const region = document.querySelector('div.sr-only[role="alert"][aria-live="assertive"]');
        if (!region) throw new Error("Assertive live region is unavailable");
        const expected = "Chat changed while saving runtime settings. Your message was kept as a draft.";
        const observer = new MutationObserver(() => {
          if (region.textContent === expected) {
            document.documentElement.dataset.runtimeDepartureAnnounced = "true";
            observer.disconnect();
          }
        });
        observer.observe(region, { childList: true, subtree: true, characterData: true });
      });
      releaseSave();
      await expect(page.locator("html")).toHaveAttribute("data-runtime-departure-announced", "true");
      expect(sends).toBe(0);
      await expect(composer).toHaveValue("Destination draft must survive");
      await expect.poll(() => page.evaluate(() => Object.values(localStorage).includes("Destination draft must survive"))).toBe(true);
      if (departure === "project") {
        await main.getByRole("button", { name: /^Project:/ }).click();
        await page.locator(".cave-project-picker__row").filter({ hasText: "Context alpha" }).first().locator(".ui-popover-item").click();
        await expect(composer).toHaveValue("Origin message waiting for runtime");
      }
    } finally {
      releaseSave();
    }
  });
}

test("a slow transcript for the previous thread never paints into the thread you switched to", async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === "/api/chat/conversation/context-a", async (route) => {
    await pending;
    await route.fallback();
  });
  try {
    // Open A while its transcript is held, then switch to B before it lands.
    await page.locator(".cnav__thread-main").filter({ hasText: "Context thread A" }).first().click();
    await openThread(page, "B");
    const main = page.getByTestId("chat-main");

    const lateA = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/chat/conversation/context-a");
    release();
    await lateA;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    // B keeps its transcript and A's late response never paints into it.
    await expect(main.locator('[data-turn-id="context-b-999"]')).toBeAttached();
    await expect(main.locator('[data-turn-id^="context-a-"]')).toHaveCount(0);
  } finally {
    release();
  }
});

test("scrolling history keeps the same empty composer mounted and the viewport stable", async ({ page }, testInfo) => {
  await setup(page);
  await openThread(page, "A");
  const main = page.getByTestId("chat-main");
  const composer = main.getByRole("textbox", { name: "Message", exact: true });
  await expect(composer).toBeVisible();
  const handle = await composer.elementHandle();
  const scroll = main.locator(".cave-chat-transcript");
  for (const width of [1280, 740, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const before = await scroll.boundingBox();
    await scroll.hover();
    for (const delta of [-500, -500, 180, -200, 500, 500]) {
      await page.mouse.wheel(0, delta);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(composer).toBeVisible();
      expect(await handle!.evaluate((node) => node.isConnected)).toBe(true);
      expect((await scroll.boundingBox())!.height).toBe(before!.height);
    }
    await page.screenshot({ path: testInfo.outputPath(`composer-${width}.png`) });
  }
  await composer.fill("A stable draft while reading history");
  await scroll.hover();
  await page.mouse.wheel(0, -800);
  await expect(composer).toHaveValue("A stable draft while reading history");
});

test("daily notes generate and backfill only missing active days", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("cave:surface-preferences:v1", JSON.stringify({ version: 1, values: {
      "familiars.selectedId": "cody", "familiars.viewMode": "detail", "familiars.detailTab": "daily-notes",
    } }));
  });
  await setup(page);
  const saved = new Map<string, string>([["2026-10-02", "An existing reflection"]]);
  const generated: string[] = [];
  const activity = (date: string) => ({ date, digest: "Recorded work", context: `Evidence for ${date}`, exists: saved.has(date) });
  await page.route("**/api/familiars/cody/notes**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/generate")) {
      if (route.request().method() === "POST") {
        const { date, reflection } = route.request().postDataJSON();
        const exists = saved.has(date);
        if (!exists) { saved.set(date, reflection); generated.push(date); }
        return route.fulfill({ json: { ok: true, status: exists ? "existing" : "generated" } });
      }
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      return route.fulfill({ json: { ok: true, days: from === to ? (from === "2026-10-03" ? [] : [activity(from)]) : [activity("2026-10-01"), activity("2026-10-02")], continuity: "An earlier intention." } });
    }
    const date = url.searchParams.get("date");
    return route.fulfill({ json: date ? { ok: true, exists: saved.has(date), note: { notes: saved.has(date) ? "Recorded work" : "", reflection: saved.get(date) ?? "" }, modified: saved.has(date) ? now : null }
      : { ok: true, dates: [...saved].map(([date, reflection]) => ({ date, preview: reflection, hasReflection: true, modified: now })) } });
  });
  await page.route("**/api/chat/generate/journal", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.familiarId).toBe("cody");
    expect(body.permissionMode).toBe("read");
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"kind":"assistant_chunk","text":"I learned to check the evidence."}\n\ndata: {"kind":"done"}\n\n' });
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "agents" } })));
  const generate = page.getByRole("button", { name: "Generate", exact: true });
  await expect(generate).toBeEnabled({ timeout: 30000 });
  await generate.click();
  await expect(page.locator("#daily-notes-reflection")).toHaveValue("I learned to check the evidence.");
  await expect(generate).toBeDisabled();
  await page.getByText("Backfill previous days", { exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Through", { exact: true }).fill("2026-10-03");
  await page.getByRole("button", { name: "Backfill active days" }).click();
  await expect.poll(() => generated.includes("2026-10-01")).toBe(true);
  expect(generated).toHaveLength(2);
  expect(saved.get("2026-10-02")).toBe("An existing reflection");
  expect(saved.has("2026-10-03")).toBe(false);
  await expect(page.getByRole("status").filter({ hasText: "1 note generated." }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("daily-notes-dark.png") });
  await page.evaluate(() => { document.documentElement.dataset.mode = "light"; document.documentElement.dataset.theme = "tide"; });
  await page.setViewportSize({ width: 740, height: 900 });
  await expect(generate).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("daily-notes-light-tide.png") });
});
