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

// End-truncated rail titles expose a full accessible title separately from
// their visible text. Require the visible renderer without masking duplicate rows.
function railTitle(root: Locator, title: string) {
  return root.getByText(title, { exact: true }).and(root.locator(".chat-row-title__head"));
}

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

async function narrowChatRail(page: Page, width = 200) {
  const cnav = page.locator(RAIL);
  await cnav.evaluate((element, width) => {
    const nav = element as HTMLElement;
    const host = nav.closest<HTMLElement>(".chat-inner-rail");
    for (const node of [host, nav]) {
      if (!node) continue;
      Object.assign(node.style, {
        width: `${width}px`,
        minWidth: `${width}px`,
        maxWidth: `${width}px`,
      });
    }
  }, width);
  await expect.poll(async () => (await cnav.boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(width + 12);
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
      const openNav = page.getByRole("button", { name: /^Open navigation \((?:⌘|Ctrl\+)B\)$/ });
      if (await openNav.isVisible().catch(() => false)) await openNav.click();
    }
    await chatDestination.click();
    await surface.waitFor({ state: "visible", timeout: 30_000 });
  }
  if (expectRail) await page.waitForSelector(RAIL, { timeout: 30_000 });
}

async function gotoChat(page: Page, { expectRail = true, sessions = SESSIONS, sessionsFail = false } = {}) {
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
    sessionsFail
      ? route.fulfill({ status: 503, json: { ok: false, error: "daemon unavailable" } })
      : route.fulfill({ json: { ok: true, sessions } }),
  );
  await page.route("**/api/projects**", (route) =>
    route.fulfill({ json: { ok: true, projects: PROJECTS } }),
  );
  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded" });
  await ensureChatSurface(page, { expectRail });
}

test.describe("chat threads rail", () => {
  test("a failed sessions read says so and offers Retry instead of claiming no conversations", async ({ page }) => {
    // Design language §10: a failed request never renders as a convincing
    // empty collection (#5527).
    await gotoChat(page, { sessionsFail: true });
    const rail = page.locator(RAIL);
    await expect(rail.getByRole("alert")).toContainText("Couldn't load chats", { timeout: 30_000 });
    await expect(rail.getByRole("button", { name: "Retry loading chats" })).toBeVisible();
    await expect(rail.getByText("No conversations yet.")).toHaveCount(0);
  });

  test("a degraded refresh updates local rows and quietly retains daemon chats (#6027)", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    await expect(railTitle(rail, "Wire deploy pipeline")).toBeVisible({ timeout: 30_000 });
    // Daemon unreachable: the server answers ok with only the local rows.
    await page.route("**/api/sessions/list**", (route) =>
      route.fulfill({ json: { ok: true, degraded: true, error: "daemon http 503", sessions: [{ ...SESSIONS[0], title: "Updated local chat" }] } }),
    );
    await expect(railTitle(rail, "Updated local chat")).toBeVisible({ timeout: 20_000 });
    await expect(rail.getByText("Coven isn't reachable", { exact: false })).toHaveCount(0);
    await expect(railTitle(rail, "Wire deploy pipeline")).toBeVisible();
  });

  test("failed refreshes keep chats quiet and recover automatically (#6027)", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    await expect(railTitle(rail, "Wire deploy pipeline")).toBeVisible({ timeout: 30_000 });
    let failures = 0;
    let failing = true;
    await page.route("**/api/sessions/list**", (route) => {
      if (failing) {
        failures += 1;
        return route.fulfill({ status: 503, json: { ok: false, error: "daemon unavailable" } });
      }
      return route.fulfill({ json: { ok: true, sessions: SESSIONS.map((row, index) =>
        index === 0 ? { ...row, title: "Recovered chat title" } : row,
      ) } });
    });
    // Two failed polls prove that retries keep running while cached chats stay
    // usable, without relying on the removed banner as a synchronization hook.
    await expect.poll(() => failures, { timeout: 25_000 }).toBeGreaterThanOrEqual(2);
    await expect(railTitle(rail, "Wire deploy pipeline")).toBeVisible();
    await expect(rail.getByText("Couldn't refresh chats", { exact: false })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Retry loading chats" })).toHaveCount(0);
    failing = false;
    await expect(railTitle(rail, "Recovered chat title")).toBeVisible({ timeout: 25_000 });
    await expect(railTitle(rail, "Wire deploy pipeline")).toBeVisible();
  });

  test("a #chat deep link survives a failed first list load (#5563)", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:active-familiar", "nova");
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });
    await page.route("**/api/familiars**", (route) =>
      route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
    );
    await page.route("**/api/projects**", (route) =>
      route.fulfill({ json: { ok: true, projects: PROJECTS } }),
    );
    await page.route("**/api/sessions/list**", (route) =>
      route.fulfill({ status: 503, json: { ok: false, error: "daemon unavailable" } }),
    );
    await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
      json: {
        ok: true,
        context: { task: null, github: [] },
        conversation: {
          familiarId: "nova",
          activeLeafId: "t2",
          turns: [
            { id: "t1", parentId: null, role: "user", text: "Where did the deploy stall?", createdAt: iso(0) },
            { id: "t2", parentId: "t1", role: "assistant", text: "The deploy stalled at the migration step.", createdAt: iso(0) },
          ],
        },
      },
    }));
    await page.goto("/#chat-s9", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("The deploy stalled at the migration step.")).toBeVisible({ timeout: 45_000 });
    expect(new URL(page.url()).hash).toBe("#chat-s9");
  });

  test("the familiar is chosen only at the top of the page, never inside Chat (#5565)", async ({ page }) => {
    await gotoChat(page);
    const surface = page.locator(".chat-surface");
    const visibleTrigger = (scope: Locator) =>
      scope.locator(".familiar-switcher__trigger").filter({ visible: true });
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 900, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(surface).toBeVisible();
      await expect(visibleTrigger(surface), `no in-chat picker at ${viewport.width}px`).toHaveCount(0);
      await expect
        .poll(() => visibleTrigger(page.locator("body")).count(), { message: `a top-of-page picker at ${viewport.width}px` })
        .toBeGreaterThan(0);
    }
  });

  test("an unchanged list poll is answered with 304 and keeps the rows (#5571)", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    await expect(railTitle(rail, "Wire deploy pipeline")).toBeVisible({ timeout: 30_000 });
    let tag = '"list-v1"';
    let rows = SESSIONS;
    const conditional: Array<string | null> = [];
    let notModified = 0;
    await page.route("**/api/sessions/list**", (route) => {
      const sent = route.request().headers()["if-none-match"] ?? null;
      conditional.push(sent);
      if (sent === tag) {
        notModified += 1;
        return route.fulfill({ status: 304, headers: { ETag: tag } });
      }
      return route.fulfill({ json: { ok: true, sessions: rows }, headers: { ETag: tag } });
    });
    // The next poll picks up the tag, the ones after it send it back.
    await expect.poll(() => notModified, { timeout: 30_000 }).toBeGreaterThan(1);
    await expect(railTitle(rail, "Wire deploy pipeline")).toBeVisible();
    await expect(railTitle(rail, "Refactor auth flow")).toBeVisible();
    expect(conditional.some((sent) => sent === '"list-v1"')).toBe(true);

    // A changed list gets a new tag and a full body, and the rail shows it.
    rows = SESSIONS.map((session) => (session.id === "s4" ? { ...session, title: "Wire the release pipeline" } : session));
    tag = '"list-v2"';
    await expect(railTitle(rail, "Wire the release pipeline")).toBeVisible({ timeout: 30_000 });
  });

  test("minimal sidebar remains legible across rail widths and palettes", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem("cave:chat:pinned-sessions", JSON.stringify(["s2"]));
    });
    await gotoChat(page);
    const rail = page.locator(RAIL);
    for (const width of [220, 280, 400]) {
      await narrowChatRail(page, width);
      for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
        await page.evaluate(([theme, mode]) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.mode = mode;
        }, [theme, mode]);
        await expect(rail.locator(".cnav__thread-main")).toHaveCount(SESSIONS.length);
        for (const session of SESSIONS) await expect(railTitle(rail, session.title)).toBeVisible();
        const screenshot = testInfo.outputPath(`sidebar-${width}-${theme}-${mode}.png`);
        await rail.screenshot({ path: screenshot });
        await testInfo.attach(`sidebar-${width}-${theme}-${mode}`, {
          path: screenshot, contentType: "image/png",
        });
      }
    }
  });

  test("flat rows stay unique with symmetric control radii and side insets", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cave:chat:pinned-sessions", JSON.stringify(["s2", "s5"]));
    });
    await gotoChat(page);
    const rail = page.locator(RAIL);
    const row = rail.locator(".cnav__thread", { hasText: "Review active pull request" }).first();
    await row.locator("button.cnav__thread-main").click();
    await expect(row).toHaveClass(/is-active/);

    for (const mode of ["dark", "light"]) {
      for (const radius of ["0px", "12px", "20px"]) {
        await page.evaluate(({ mode, radius }) => {
          document.documentElement.dataset.mode = mode;
          document.documentElement.style.setProperty("--radius-control", radius);
        }, { mode, radius });
        const geometry = await rail.evaluate((element) => {
          const scroller = element.querySelector(".cnav__scroll")!;
          const scrollStyle = getComputedStyle(scroller);
          const rows = Array.from(element.querySelectorAll(".cnav__thread"));
          const corners = (style: CSSStyleDeclaration) => [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ];
          return {
            insideShellNav: element.closest(".shell-nav") !== null,
            paddingLeft: scrollStyle.paddingLeft,
            paddingRight: scrollStyle.paddingRight,
            rows: rows.map((thread) => ({
              corners: corners(getComputedStyle(thread)),
              backdropDisplay: getComputedStyle(thread, "::after").display,
            })),
          };
        });
        expect(geometry.insideShellNav).toBe(false);
        expect(geometry.paddingLeft).toBe("4px");
        expect(geometry.paddingRight).toBe("4px");
        expect(geometry.rows).toHaveLength(SESSIONS.length);
        for (const thread of geometry.rows) {
          expect(thread.corners).toEqual(Array(4).fill(radius));
          expect(thread.backdropDisplay).toBe("none");
        }
      }
    }
  });

  test("rail titles retain their start while session-list titles retain their tail", async ({ page }) => {
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

    const assertRailTitle = async (fullTitle: string) => {
      const renderer = page.locator(RAIL).locator(`.chat-row-title[title="${fullTitle}"]`);
      await expect(renderer).toHaveCount(1);
      await expect(renderer.locator(".sr-only")).toHaveText(fullTitle);
      await expect(renderer.locator(".chat-row-title__tail")).toHaveCount(0);
      const head = renderer.locator(".chat-row-title__head");
      await expect(head).toHaveText(fullTitle);
      await expect(head).toHaveCSS("text-overflow", "ellipsis");
      await expect(head).toHaveCSS("white-space", "pre");
      await expect(head).toHaveCSS("overflow", "hidden");
      const bounds = await head.evaluate((element) => ({
        width: element.clientWidth, fullWidth: element.scrollWidth,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        rowRight: element.closest(".cnav__thread")!.getBoundingClientRect().right,
      }));
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.fullWidth).toBeGreaterThan(bounds.width);
      expect(bounds.right).toBeLessThanOrEqual(bounds.rowRight);
      await expect(renderer.locator("xpath=ancestor::button[1]")).toHaveAccessibleName(new RegExp(fullTitle));
      return bounds.left;
    };

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
      const ordinaryLeft = await assertRailTitle(title);
      const pinnedLeft = await assertRailTitle(pinnedTitle);
      expect(ordinaryLeft).toBe(pinnedLeft);
    }
    await page.getByRole("tablist", { name: "Chat sections" }).getByRole("tab", { name: "Projects", exact: true }).click();
    await page.getByRole("tablist", { name: "Chat sections" }).getByRole("tab", { name: "Chats", exact: true }).click();
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
    await page.getByRole("tab", { name: "Chats", exact: true }).click();
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
      titleBottom: element.querySelector(".cnav__thread-title")!.getBoundingClientRect().bottom,
      actionsTop: element.querySelector(".cnav__row-actions")!.getBoundingClientRect().top,
    }));
    expect(titleAndActions.titleBottom).toBeLessThanOrEqual(titleAndActions.actionsTop);

    await actions.first().click();
    const pinnedUnpin = page.locator(RAIL).getByRole("button", { name: "Unpin Refactor auth flow", exact: true });
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
      await expect(railTitle(rail, s.title)).toBeVisible();
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
    await expect(railTitle(rail, "Wire deploy pipeline")).toBeVisible();
  });

  test("blocked attention stays visible and accessible in wide and narrow rails", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    const row = rail.locator(".cnav__thread", { hasText: "Approve release checklist" });
    const button = row.locator("button.cnav__thread-main");
    for (const narrow of [false, true]) {
      if (narrow) await narrowChatRail(page);
      await expect(rail.locator('section[aria-label="Awaiting you"]')).toBeVisible();
      await expect(railTitle(row, "Approve release checklist")).toBeVisible();
      await expect(row.locator(".cnav__thread-project")).toBeVisible();
      await expect(row.locator(".cnav__attention")).toBeVisible();
      await expect(row.locator(".cnav__attention")).toHaveText("Blocked");
      await expect(button).toHaveAccessibleName(/^Approve release checklist.*alpha.*Runtime: Codex.*Blocked$/);
      await expect(button).toHaveAttribute("aria-describedby", /.+/);
      await expect(button).toHaveAccessibleDescription(/.+/);
    }
  });

  test("selected failed PR row keeps its independent PR control without redundant waiting cues", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(RAIL);
    const row = rail.locator(".cnav__thread", { hasText: "Review active pull request" });
    const button = row.locator("button.cnav__thread-main");
    const pr = row.getByRole("button", { name: /^Open pull request/ });
    await button.click();
    for (const narrow of [false, true]) {
      if (narrow) await narrowChatRail(page);
      await expect(button).toHaveAttribute("aria-current", "page");
      await expect(row.locator(".cnav__runtime-state")).toHaveText("Failed");
      await expect(row.locator(".cnav__runtime-state")).toBeVisible();
      await expect(row.locator(".cnav__attention")).toBeHidden();
      await expect(button).toHaveAccessibleDescription(/.+/);
      await expect(pr).toBeVisible();
      const geometry = await row.evaluate((element) => {
        const badge = element.querySelector(".cnav__pr-badge")!;
        const box = badge.getBoundingClientRect();
        const title = element.querySelector(".cnav__thread-title")!.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { prRight: box.right, titleLeft: title.left, reachable: hit !== null && badge.contains(hit) };
      });
      expect(geometry.prRight).toBeLessThanOrEqual(geometry.titleLeft);
      expect(geometry.reachable).toBe(true);
      await button.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(pr).toBeFocused();
      await expect(pr).toHaveCSS("outline-style", "solid");
    }
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
    await expect(railTitle(sheet, "Refactor auth flow")).toBeVisible();

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
    const openNav = page.getByRole("button", { name: /^Open navigation \((?:⌘|Ctrl\+)B\)$/ });

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
    await expect(page.getByRole("button", { name: /^Open navigation \((?:⌘|Ctrl\+)B\)$/ })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".mobile-drawer-backdrop")).toHaveCount(0);
  });
});
