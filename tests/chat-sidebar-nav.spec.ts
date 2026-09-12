import { expect, test, type Locator, type Page } from "@playwright/test";

// Verifies the chat threads rail. Until cave-fh9so this list REPLACED
// SidebarMinimal in the Shell nav whenever Chat was active; it is now a rail
// docked inside the chat surface itself, so the app sidebar is the same on
// every surface and the list persists beside both the thread list and an open
// conversation.
//
// Covered: where the rail is mounted, its collapse/spine cycle and persistence,
// the recency + attention grouping it renders, its behaviour when narrow, and
// the mobile sheet that stands in for it below 1024px (where the rail and its
// spine are both display:none and the list would otherwise be unreachable).
// /api/familiars + /api/sessions/list + /api/projects are mocked.

// Timestamps are relative to the test run so bucket labels are deterministic:
// s1 → Today, s2 → Yesterday, s3/s5 → Previous 7 days, s4 → Older.
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const NO_ATTENTION = { state: "none", since: null, reason: null } as const;
const PROJECTS = [
  {
    id: "project-alpha",
    name: "alpha",
    root: "/repo/alpha",
    repoUrl: "https://github.com/OpenCoven/alpha",
    createdAt: iso(60),
    updatedAt: iso(0),
  },
  {
    id: "project-beta",
    name: "beta",
    root: "/repo/beta",
    repoUrl: "https://github.com/Acme/beta",
    createdAt: iso(60),
    updatedAt: iso(4),
  },
];
const SESSIONS = [
  { id: "s1", title: "Refactor auth flow", status: "running", origin: "chat", project_root: "/repo/alpha", updated_at: iso(0), attention: NO_ATTENTION },
  { id: "s2", title: "Fix eslint config", status: "completed", origin: "board", project_root: "/repo/alpha", updated_at: iso(1), attention: NO_ATTENTION },
  { id: "s3", title: "Write API docs", status: "completed", origin: "chat", project_root: "/repo/beta", updated_at: iso(4), attention: NO_ATTENTION },
  { id: "s4", title: "Wire deploy pipeline", status: "running", origin: "board", project_root: "/repo/beta", updated_at: iso(40), attention: NO_ATTENTION },
  {
    id: "s5",
    title: "Approve release checklist",
    status: "completed",
    origin: "chat",
    project_root: "/repo/alpha",
    updated_at: iso(2),
    attention: { state: "awaiting-human", since: iso(2), reason: "approval" },
  },
  {
    id: "s6",
    title: "Review active pull request",
    status: "failed",
    origin: "chat",
    project_root: "/repo/alpha",
    updated_at: iso(0),
    attention: { state: "awaiting-human", since: iso(0), reason: "review" },
    pullRequest: {
      repo: "OpenCoven/coven-cave",
      number: 42,
      url: "https://github.com/OpenCoven/coven-cave/pull/42",
      state: "open",
    },
  },
].map((s) => ({
  ...s,
  harness: "codex",
  familiarId: "nova",
  exit_code: null,
  archived_at: null,
  created_at: s.updated_at,
}));

// The rail lives inside the chat surface now, NOT inside aside[aria-label="Sidebar"].
const RAIL = 'aside[aria-label="Chat threads"] .chat-sidebar';

async function renderedBox(locator: Locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      display: style.display,
      visibility: style.visibility,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function narrowChatRail(page: Page) {
  const cnav = page.locator(RAIL);
  await cnav.evaluate((element) => {
    const nav = element as HTMLElement;
    const host = nav.closest<HTMLElement>(".chat-inner-rail");
    for (const node of [host, nav]) {
      if (!node) continue;
      Object.assign(node.style, {
        width: "200px",
        minWidth: "200px",
        maxWidth: "200px",
      });
    }
  });
  await expect.poll(async () => (await cnav.boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(212);
}

async function activeCueBoxes(row: Locator) {
  return row.evaluate((element) => {
    const rowRect = element.getBoundingClientRect();
    const boxFor = (selector: string) => {
      const rect = element.querySelector(selector)?.getBoundingClientRect();
      if (!rect) throw new Error(`Missing ${selector}`);
      return { left: rect.left, right: rect.right };
    };
    const selection = window.getComputedStyle(element, "::before");
    const selectionLeft = rowRect.left + Number.parseFloat(selection.left);
    return {
      selection: {
        left: selectionLeft,
        right: selectionLeft + Number.parseFloat(selection.width),
      },
      attention: boxFor(".cnav__attention-tick"),
      runtime: boxFor(".cnav__tick"),
      pullRequest: boxFor(".cnav__pr-badge"),
    };
  });
}

function expectHorizontalSeparation(
  boxes: Awaited<ReturnType<typeof activeCueBoxes>>,
  viewport: "normal" | "narrow",
) {
  const ordered = [boxes.selection, boxes.attention, boxes.runtime, boxes.pullRequest];
  for (let index = 1; index < ordered.length; index += 1) {
    expect(
      ordered[index - 1].right,
      `${viewport} cue ${index - 1} must end before cue ${index} begins`,
    ).toBeLessThanOrEqual(ordered[index].left);
  }
}

async function ensureChatSurface(page: Page, { expectRail = true } = {}) {
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  const surface = page.locator(".chat-surface");
  try {
    await surface.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const nav = page.locator('aside[aria-label="Sidebar"]');
    const chatDestination = nav.getByRole("button", { name: /^Chat\b/ }).first();
    if (!(await chatDestination.isVisible().catch(() => false))) {
      const openNav = page.getByRole("button", { name: /^Open navigation \((?:⌘|Ctrl)B\)$/ });
      if (await openNav.isVisible().catch(() => false)) await openNav.click();
    }
    await chatDestination.click();
    await surface.waitFor({ state: "visible", timeout: 30_000 });
  }
  if (expectRail) await page.waitForSelector(RAIL, { timeout: 30_000 });
}

async function gotoChat(page: Page, { expectRail = true, sessions = SESSIONS } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions } }),
  );
  await page.route("**/api/projects**", (route) =>
    route.fulfill({ json: { ok: true, projects: PROJECTS } }),
  );
  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded" });
  await ensureChatSurface(page, { expectRail });
}

test.describe("chat threads rail", () => {
  test("middle ellipsis preserves title tails in narrow rail and session rows", async ({ page }) => {
    const title = "Investigate a shared deployment prefix and keep the distinguishing release suffix";
    const pinnedTitle = "Review a second shared deployment prefix and preserve the production suffix";
    await page.addInitScript(() => {
      localStorage.setItem("cave:chat:pinned-sessions", JSON.stringify(["s2"]));
    });
    await gotoChat(page, {
      sessions: SESSIONS.map((session) => ({
        ...session,
        title: session.id === "s1" ? title : session.id === "s2" ? pinnedTitle : session.title,
      })),
    });
    await narrowChatRail(page);

    const assertTailVisible = async (root: Locator, fullTitle: string) => {
      const renderer = root.locator(`.chat-row-title[title="${fullTitle}"]`).first();
      await expect(renderer).toBeVisible();
      await renderer.scrollIntoViewIfNeeded();
      await expect(renderer.locator(".sr-only")).toHaveText(fullTitle);
      await expect(renderer.locator(".chat-row-title__tail")).toHaveText(fullTitle.slice(-18));
      const bounds = await renderer.evaluate((element) => {
        const tail = element.querySelector(".chat-row-title__tail")!;
        const text = tail.firstElementChild!.firstChild!;
        const range = document.createRange();
        range.setStart(text, text.textContent!.length - 6);
        range.setEnd(text, text.textContent!.length);
        const suffix = range.getBoundingClientRect();
        const clip = tail.getBoundingClientRect();
        const row = element.getBoundingClientRect();
        const hit = document.elementFromPoint((suffix.left + suffix.right) / 2, (suffix.top + suffix.bottom) / 2);
        return { suffixLeft: suffix.left, suffixRight: suffix.right, clipLeft: clip.left, clipRight: clip.right, rowRight: row.right, unobscured: hit !== null && tail.contains(hit) };
      });
      expect(bounds.suffixLeft).toBeGreaterThanOrEqual(bounds.clipLeft - 1);
      expect(bounds.suffixRight).toBeLessThanOrEqual(bounds.clipRight + 1);
      expect(bounds.clipRight).toBeLessThanOrEqual(bounds.rowRight + 1);
      expect(bounds.unobscured).toBe(true);
    };

    for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
      await page.evaluate(([theme, mode]) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.mode = mode;
      }, [theme, mode]);
      await assertTailVisible(page.locator(RAIL), title);
      await assertTailVisible(page.locator(RAIL), pinnedTitle);
    }
    await page.getByRole("tablist", { name: "Chat sections" }).getByRole("tab", { name: "Projects", exact: true }).click();
    await page.getByRole("tablist", { name: "Chat sections" }).getByRole("tab", { name: "Sessions", exact: true }).click();
    const list = page.getByTestId("chat-main").locator(".chat-list-surface");
    await assertTailVisible(list, title);
    await assertTailVisible(list, pinnedTitle);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await list.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(390);
    for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
      await page.evaluate(([theme, mode]) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.mode = mode;
      }, [theme, mode]);
      await assertTailVisible(list, title);
      await assertTailVisible(list, pinnedTitle);
    }
    await list.getByRole("textbox", { name: "Filter sessions", exact: true }).fill("distinguishing");
    await assertTailVisible(list, title);
    await expect(list.locator(`.chat-row-title[title="${pinnedTitle}"]`)).toHaveCount(0);
  });

  test("desktop session-list actions have 32px targets and keyboard focus rings", async ({ page }, testInfo) => {
    await gotoChat(page);
    await page.getByRole("tab", { name: "Projects", exact: true }).click();
    await page.getByRole("tab", { name: "Sessions", exact: true }).click();
    const row = page.locator(".chat-list-row").filter({ hasText: "Refactor auth flow" });
    await row.hover();
    const actions = row.locator(".chat-list-row-actions button");
    await expect(actions).toHaveCount(5);
    const boxes = await Promise.all((await actions.all()).map(renderedBox));
    await testInfo.attach("session-list-target-boxes", { body: JSON.stringify(boxes), contentType: "application/json" });
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(32);
    }
    await page.mouse.move(0, 0);
    for (const action of await actions.all()) {
      await page.keyboard.press("Tab");
      await action.focus();
      await expect(action).toHaveCSS("opacity", "1");
      await expect(action).toHaveCSS("outline-style", "solid");
      await expect(action).toHaveCSS("outline-width", "2px");
    }
    await actions.first().click();
    const sectionToggle = page.getByRole("button", { name: "Collapse Pinned", exact: true });
    await expect(sectionToggle).toBeVisible();
    const sectionBox = await renderedBox(sectionToggle);
    expect(sectionBox.width).toBeGreaterThanOrEqual(32);
    expect(sectionBox.height).toBeGreaterThanOrEqual(32);
    await page.keyboard.press("Tab");
    await sectionToggle.focus();
    await expect(sectionToggle).toHaveCSS("outline-style", "solid");
    await expect(sectionToggle).toHaveCSS("outline-width", "2px");
  });

  test("desktop row controls have 32px targets and visible keyboard focus", async ({ page }, testInfo) => {
    await gotoChat(page);
    const row = page.locator(RAIL).locator(".cnav__thread").filter({ hasText: "Refactor auth flow" });
    await row.hover();
    const actions = row.locator(".cnav__row-actions > button");
    await expect(actions).toHaveCount(3);
    const targets = [...await actions.all(), page.getByRole("button", { name: "Collapse chat list" })];
    const boxes = await Promise.all(targets.map(renderedBox));
    await testInfo.attach("desktop-target-boxes", { body: JSON.stringify(boxes), contentType: "application/json" });
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(32);
    }
    await page.mouse.move(0, 0);
    await row.locator(".cnav__thread-main").focus();
    await page.keyboard.press("Tab");
    await expect(actions.first()).toBeFocused();
    for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
      await page.evaluate(([theme, mode]) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.mode = mode;
      }, [theme, mode]);
      await expect(actions.first()).toHaveCSS("opacity", "1");
      await expect(actions.first()).toHaveCSS("outline-style", "solid");
      await expect(actions.first()).toHaveCSS("outline-width", "2px");
    }
    await narrowChatRail(page);
    const titleAndActions = await row.evaluate((element) => ({
      titleRight: element.querySelector(".cnav__thread-copy")!.getBoundingClientRect().right,
      actionsLeft: element.querySelector(".cnav__row-actions")!.getBoundingClientRect().left,
    }));
    expect(titleAndActions.titleRight).toBeLessThanOrEqual(titleAndActions.actionsLeft);

    await actions.first().click();
    const pinnedUnpin = page.locator(RAIL).locator('button[title="Unpin chat"]')
      .and(page.getByRole("button", { name: "Unpin Refactor auth flow", exact: true }));
    await expect(pinnedUnpin).toBeVisible();
    const pinnedBox = await renderedBox(pinnedUnpin);
    expect(pinnedBox.width).toBeGreaterThanOrEqual(32);
    expect(pinnedBox.height).toBeGreaterThanOrEqual(32);
    await page.keyboard.press("Tab");
    await pinnedUnpin.focus();
    await expect(pinnedUnpin).toHaveCSS("outline-style", "solid");
    await expect(pinnedUnpin).toHaveCSS("outline-width", "2px");
  });

  test("is docked in the chat surface, leaving the app sidebar unchanged", async ({ page }) => {
    await gotoChat(page);
    const nav = page.locator('aside[aria-label="Sidebar"]');

    // Exactly one list, and it is inside the surface — not the app rail.
    await expect(page.locator(".chat-sidebar")).toHaveCount(1);
    await expect(page.locator(RAIL)).toBeVisible();
    await expect(nav.locator(".chat-sidebar")).toHaveCount(0);

    // The app sidebar keeps its ordinary destinations while Chat is open. This
    // is the regression the whole change is about: Chat used to swap them out.
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("button", { name: /^Chat\b/ }).first()).toBeVisible();

    // Neither of the older list surfaces comes back alongside it.
    await expect(page.locator('aside[aria-label="List pane"]')).toHaveCount(0);
    await expect(page.locator(".chat-thread-rail")).toHaveCount(0);
  });

  test("the title row collapses to a spine, the spine restores, and the choice survives a reload", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    const collapse = page.getByRole("button", { name: "Collapse chat list" });
    const spine = page.getByRole("button", { name: "Expand chat list" });

    await expect(rail).toBeVisible();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");

    // The whole header row is the control, not a small icon target inside it.
    await collapse.click();
    await expect(rail).toHaveCount(0);
    await expect(spine).toBeVisible();
    await expect(spine).toHaveAttribute("aria-expanded", "false");

    // Collapsed state persists — otherwise the spine would be the only way back
    // and every reload would undo the choice.
    await page.reload();
    await ensureChatSurface(page, { expectRail: false });
    await expect(page.getByRole("button", { name: "Expand chat list" })).toBeVisible();
    await expect(page.locator(RAIL)).toHaveCount(0);

    await page.getByRole("button", { name: "Expand chat list" }).click();
    await expect(page.locator(RAIL)).toBeVisible();
  });

  test("lists every thread bucketed by recency, with attention called out", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);

    await expect(rail.getByText("Today", { exact: true })).toBeVisible();
    await expect(rail.getByText("Older", { exact: true })).toBeVisible();
    for (const s of SESSIONS) {
      await expect(rail.getByText(s.title, { exact: false }).first()).toBeVisible();
    }
    // Bare row times — no "ago" suffix anywhere in the rail.
    await expect(rail.locator(".cnav__time").filter({ hasText: /\bago\b/ })).toHaveCount(0);

    // Project folder grouping and its Organize chrome are gone with the old
    // sidebar; recency plus attention is the whole structure.
    await expect(rail.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toHaveCount(0);
    await expect(rail.getByRole("tablist", { name: "Group chats" })).toHaveCount(0);
    await expect(rail.locator("section.cnav__organization")).toHaveCount(0);
    await expect(rail.locator('section[aria-label="Awaiting you"]')).toBeVisible();
  });

  test("opening a thread from the rail keeps the rail beside the conversation", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    const row = rail.locator(".cnav__thread", { hasText: "Refactor auth flow" }).first();

    await row.locator("button.cnav__thread-main").click();
    await expect(row.locator("button.cnav__thread-main")).toHaveAttribute("aria-current", "page");
    // The reason the rail is mounted at the surface rather than inside the list
    // view: it has to survive opening a conversation, which is exactly when you
    // want to switch threads.
    await expect(rail).toBeVisible();
    await expect(rail.getByText("Wire deploy pipeline", { exact: false }).first()).toBeVisible();
  });

  test("narrow rail keeps the attention label rendered after the project tile collapses", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    const attentionRow = rail.locator(".cnav__thread", { hasText: "Approve release checklist" }).first();
    const attentionButton = attentionRow.locator("button.cnav__thread-main");
    const projectTile = attentionRow.locator(".cnav__thread-proj");
    const attentionCue = attentionRow.locator(".cnav__attention");
    const attentionLabel = attentionCue.locator("span:not(.cnav__attention-dot)").first();

    await expect(rail.getByRole("heading", { name: "Awaiting you" })).toHaveCount(0);
    await expect(rail.locator('section[aria-label="Awaiting you"]')).toBeVisible();
    await expect(attentionRow.getByText("Approve release checklist", { exact: true })).toBeVisible();
    await expect(projectTile).toBeVisible();
    await expect(attentionCue).toBeVisible();
    await expect(attentionLabel).toHaveText("Awaiting you");
    const timestamp = (await attentionRow.locator(".cnav__time").textContent())?.trim();
    expect(timestamp).toBeTruthy();
    await expect(attentionButton).toHaveAccessibleName(
      new RegExp(`^Project alpha\\s+Approve release checklist\\s+${timestamp}\\s+Awaiting you$`),
    );

    await narrowChatRail(page);

    const projectState = await renderedBox(projectTile);
    expect(projectState.display).toBe("none");
    expect(projectState.visibility).not.toBe("hidden");
    expect(projectState.width).toBe(0);
    expect(projectState.height).toBe(0);

    const cueState = await renderedBox(attentionCue);
    expect(cueState.display).not.toBe("none");
    expect(cueState.visibility).not.toBe("hidden");
    expect(cueState.width).toBeGreaterThan(0);
    expect(cueState.height).toBeGreaterThan(0);

    const labelState = await renderedBox(attentionLabel);
    expect(labelState.display).not.toBe("none");
    expect(labelState.visibility).not.toBe("hidden");
    expect(labelState.width).toBeGreaterThan(0);
    expect(labelState.height).toBeGreaterThan(0);
    await expect(attentionButton).toHaveAccessibleName(
      new RegExp(`^Project alpha\\s+Approve release checklist\\s+${timestamp}\\s+Awaiting you$`),
    );
  });

  test("active PR attention row keeps selection, attention, runtime, and PR cues in separate gutters", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    const row = rail.locator(".cnav__thread", { hasText: "Review active pull request" }).first();
    const rowButton = row.locator("button.cnav__thread-main");

    await rowButton.click();
    await expect(rowButton).toHaveAttribute("aria-current", "page");
    await expect(row.locator(".cnav__attention-tick")).toBeVisible();
    await expect(row.locator(".cnav__tick")).toBeVisible();
    await expect(row.locator(".cnav__pr-badge")).toBeVisible();

    const normalBoxes = await activeCueBoxes(row);
    expectHorizontalSeparation(normalBoxes, "normal");

    await narrowChatRail(page);

    await expect(rowButton).toHaveAttribute("aria-current", "page");
    const narrowBoxes = await activeCueBoxes(row);
    expectHorizontalSeparation(narrowBoxes, "narrow");
  });

  // cave-lryhx. The reported crash was a TypeError escaping the shell's
  // window-level keydown handler:
  //
  //   Cannot read properties of undefined (reading 'toLowerCase')
  //     at matchesPanelShortcut (src/lib/panel-shortcuts.ts:65:25)
  //     at ShellInner.useEffect.handler (src/components/shell.tsx:805:31)
  //
  // Two sites are on that stack — matchesPanelShortcut, and a second direct
  // read of the key further down the SAME handler — so guarding one alone just
  // moves the throw a line. The unit tests cover matchesPanelShortcut; nothing
  // covered the shell's own read, which is why this lives here: the second site
  // only exists inside that effect, and only a real event dispatched at the
  // real window reaches it.
  //
  // The event shape is the reported one: dispatched as "keydown" but
  // constructed as a plain `Event`, so `key` is absent from the object
  // entirely. That is what a password manager, a browser extension, or an
  // IME/composition path sends, and the desktop shell is a WKWebView, where an
  // off-spec event is more likely rather than less.
  test("a keydown event with no key does not break the shell's panel shortcuts (cave-lryhx)", async ({ page }) => {
    await gotoChat(page);
    const nav = page.locator('aside[aria-label="Sidebar"]');
    await expect(nav).toBeVisible();

    // Uncaught exceptions thrown inside a listener are reported globally rather
    // than propagating to dispatchEvent's caller, so they surface here and NOT
    // as a rejected page.evaluate.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const dispatched = await page.evaluate(() => {
      const event = new Event("keydown");
      return { hasKey: "key" in event, dispatched: window.dispatchEvent(event) };
    });
    expect(dispatched.hasKey, "the reported shape carries no key at all").toBe(false);
    expect(dispatched.dispatched).toBe(true);

    // Give the error, if any, a turn of the event loop to be reported.
    await page.waitForTimeout(250);
    expect(pageErrors, "a keyless keydown must not throw out of the shell handler").toEqual([]);

    // The property that matters is not "nothing threw" — it is that the
    // shortcuts still WORK afterwards. ⌘/Ctrl+B now drives the app sidebar on
    // every surface, Chat included, so collapse and restore it here.
    //
    // Collapsed means inert + aria-hidden, NOT removed: the aside stays
    // mounted so its state survives, and Playwright rightly still calls it
    // visible. `toBeHidden()` asserts the wrong contract and fails here.
    await page.keyboard.press("ControlOrMeta+b");
    await expect(nav).toHaveAttribute("aria-hidden", "true");
    await page.keyboard.press("ControlOrMeta+b");
    await expect(nav).not.toHaveAttribute("aria-hidden", "true");

    expect(pageErrors, "and still nothing thrown after the good shortcuts").toEqual([]);
  });

  test("Command-B drives the app sidebar and leaves the threads rail alone", async ({ page }) => {
    await gotoChat(page);
    const nav = page.locator('aside[aria-label="Sidebar"]');
    const rail = page.locator(RAIL);

    await expect(nav).toBeVisible();
    await expect(rail).toBeVisible();

    // The two are independent controls now: the shortcut owns the app rail, the
    // title row owns the list. Before cave-fh9so they were the same thing.
    //
    // See the note above on why this is aria-hidden rather than toBeHidden.
    await page.keyboard.press("ControlOrMeta+b");
    await expect(nav).toHaveAttribute("aria-hidden", "true");
    await expect(rail).toBeVisible();

    await page.keyboard.press("ControlOrMeta+b");
    await expect(nav).not.toHaveAttribute("aria-hidden", "true");
    await expect(rail).toBeVisible();
  });
});

test.describe("chat threads on mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Below 1024px chat-inner-rail.css hides BOTH the docked rail and its spine —
  // there is no room for a third column. Without the sheet the session list
  // would be unreachable on a phone, since it no longer lives in the app
  // sidebar either. This is the test that pins that route open.
  test("the header toggle opens the thread list as a sheet, and picking a thread dismisses it", async ({ page }) => {
    await gotoChat(page, { expectRail: false });

    await expect(page.locator(".chat-inner-rail")).toBeHidden();
    await expect(page.locator(".chat-inner-rail__spine")).toBeHidden();

    const toggle = page.getByRole("button", { name: "Show chat list" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    const sheet = page.getByRole("dialog", { name: "Chat threads" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Refactor auth flow", { exact: false }).first()).toBeVisible();

    await sheet.locator(".cnav__thread", { hasText: "Refactor auth flow" })
      .first()
      .locator("button.cnav__thread-main")
      .click();
    // A slide-over left open over the conversation it just navigated to would
    // cover the thing you asked for.
    await expect(sheet).toHaveCount(0);
  });

  test("the sheet closes from its own header and from the backdrop", async ({ page }) => {
    await gotoChat(page, { expectRail: false });

    await page.getByRole("button", { name: "Show chat list" }).click();
    await expect(page.getByRole("dialog", { name: "Chat threads" })).toBeVisible();
    // In the sheet the header row closes an overlay rather than collapsing a
    // column, so it must not carry the rail's "Collapse" verb — or its click.
    await expect(page.getByRole("button", { name: "Collapse chat list" })).toHaveCount(0);
    // Scoped to the dialog on purpose: the backdrop carries the same accessible
    // name, so an unscoped lookup would click the backdrop and pass without
    // ever exercising the header.
    await page.getByRole("dialog", { name: "Chat threads" })
      .getByRole("button", { name: "Close chat list" })
      .click();
    await expect(page.getByRole("dialog", { name: "Chat threads" })).toHaveCount(0);

    await page.getByRole("button", { name: "Show chat list" }).click();
    await expect(page.getByRole("dialog", { name: "Chat threads" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Chat threads" })).toHaveCount(0);
  });

  test("the nav drawer still opens the app destinations, with no list drawer", async ({ page }) => {
    await gotoChat(page, { expectRail: false });
    const shell = page.locator(".shell-root");
    const openNav = page.getByRole("button", { name: /^Open navigation \((?:⌘|Ctrl)B\)$/ });

    await expect(openNav).toBeVisible();
    await expect(openNav).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /Open list|Close list/ })).toHaveCount(0);
    await expect(page.locator('aside[aria-label="List pane"]')).toHaveCount(0);
    await expect(shell).not.toHaveAttribute("data-mobile-drawer");

    await openNav.click();
    await expect(shell).toHaveAttribute("data-mobile-drawer", "nav");
    await expect(page.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");
    // The drawer carries destinations, not the session list.
    const drawerNav = page.locator('aside[aria-label="Sidebar"]');
    await expect(drawerNav.getByRole("button", { name: /^Chat\b/ }).first()).toBeVisible();
    await expect(drawerNav.locator(".chat-sidebar")).toHaveCount(0);

    const backdrop = page.locator('.mobile-drawer-backdrop[data-drawer-slot="nav"]');
    await expect(backdrop).toBeVisible();
    await backdrop.click({ position: { x: 380, y: 420 } });
    await expect(shell).not.toHaveAttribute("data-mobile-drawer");
    await expect(page.getByRole("button", { name: /^Open navigation \((?:⌘|Ctrl)B\)$/ })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".mobile-drawer-backdrop")).toHaveCount(0);
  });
});
