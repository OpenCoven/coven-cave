import { expect, test, type Page } from "@playwright/test";

// Verifies Chat mode's Chats sidebar in the shell list pane while the global
// Sidebar stays a separate nav rail. The list defaults to a time-bucketed
// "Recent chats" view (Today / Yesterday / Previous 7 days / Previous 30 days /
// Older). A ⋯ "Sidebar options" button opens an Organize menu (role=dialog)
// with menuitemradio items to switch to "By project" folder grouping. The list
// panel owns thread navigation while ChatSurface hides the duplicate internal
// rail. Desktop only. /api/familiars + /api/sessions/list are mocked.

// Timestamps are relative to the test run so bucket labels are deterministic:
// s1 → Today, s2 → Yesterday, s3 → Previous 7 days, s4 → Older.
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const SESSIONS = [
  { id: "s1", title: "Refactor auth flow", status: "running", origin: "chat", project_root: "/repo/alpha", updated_at: iso(0) },
  { id: "s2", title: "Fix eslint config", status: "completed", origin: "board", project_root: "/repo/alpha", updated_at: iso(1) },
  { id: "s3", title: "Write API docs", status: "completed", origin: "chat", project_root: "/repo/beta", updated_at: iso(4) },
  { id: "s4", title: "Wire deploy pipeline", status: "running", origin: "board", project_root: "/repo/beta", updated_at: iso(40) },
].map((s) => ({
  ...s,
  harness: "codex",
  familiarId: "nova",
  exit_code: null,
  archived_at: null,
  created_at: s.updated_at,
}));

async function ensureChatSurface(page: Page) {
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  const surface = page.locator(".chat-surface");
  if (!(await surface.isVisible().catch(() => false))) {
    await page.locator('aside[aria-label="Sidebar"]').getByRole("button", { name: /^Chat\b/ }).first().click();
  }
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.waitForSelector('aside[aria-label="List pane"] .chat-sidebar', { timeout: 30_000 });
}

async function gotoChat(page: Page, options?: { pinnedSessionIds?: string[] }) {
  await page.addInitScript(({ pinnedSessionIds }) => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:chat:pinned-sessions", JSON.stringify(pinnedSessionIds ?? []));
    // Seed the remembered global-nav preference OPEN; chat visits must still
    // collapse the nav for the visit while keeping the separate Chats list open.
    window.localStorage.setItem("cave:shell:nav-open", "1");
  }, { pinnedSessionIds: options?.pinnedSessionIds ?? [] });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  );
  await page.goto("/?mode=chat");
  // Deep-link to Chat, with a sidebar click fallback if the shell restores Home
  // before the mode param is applied.
  await ensureChatSurface(page);
}

test.describe("chat sidebar (session navigator)", () => {
  test("chat visit collapses remembered nav but keeps the persistent Chats list", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator('aside[aria-label="List pane"] .chat-sidebar');
    const nav = page.locator('aside[aria-label="Sidebar"]');
    const search = sidebar.getByRole("searchbox", { name: "Search projects and threads" });

    // Chat mode keeps the global nav separate and temporarily collapsed even if
    // the remembered preference is open; the persistent Chats list remains live.
    await expect(sidebar).toBeVisible();
    await expect(search).toBeVisible();
    await expect(nav).toBeVisible();
    await expect(nav.locator(".chat-sidebar")).toHaveCount(0);
    await expect(page.locator(".chat-thread-rail")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cave:shell:nav-open"))).toBe("1");
    const navToggle = page.getByRole("button", { name: "Expand navigation" });
    await expect(navToggle).toHaveAttribute("aria-expanded", "false");

    // The desktop list shortcut must not collapse the persistent Chats list.
    await page.keyboard.press("Control+\\");
    await expect(search).toBeVisible();
    await expect(navToggle).toHaveAttribute("aria-expanded", "false");

    await navToggle.click();
    await expect(search).toBeVisible();
    await expect(page.getByRole("button", { name: /Expand navigation|Collapse navigation to icons/ })).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cave:shell:nav-open"))).toBe("1");
  });

  test("defaults to the Recent view; Organize menu switches to project folders", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator('aside[aria-label="List pane"] .chat-sidebar');

    // Search control survives in both views.
    await expect(sidebar.getByRole("searchbox", { name: "Search projects and threads" })).toBeVisible();

    // Recent is the default: time-bucket headers, no project folder toggles.
    await expect(sidebar.getByText("Today", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Older", { exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toHaveCount(0);
    for (const s of SESSIONS) {
      await expect(sidebar.getByText(s.title, { exact: false }).first()).toBeVisible();
    }
    // Bare row times — no "ago" suffix anywhere in the sidebar.
    await expect(sidebar.getByText(/\bago\b/)).toHaveCount(0);

    // Organize sidebar → By project restores the folder grouping.
    await sidebar.getByRole("button", { name: "Sidebar options" }).click();
    const menu = page.getByRole("dialog", { name: "Sidebar options" });
    await expect(menu.getByRole("menuitemradio", { name: "Recent chats" })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: "By project" }).click();
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) beta threads/ })).toBeVisible();

    // The organize choice persists across a reload.
    await page.reload();
    await ensureChatSurface(page);
    const reloadedSidebar = page.locator('aside[aria-label="List pane"] .chat-sidebar');
    await expect(page.getByRole("button", { name: "Expand navigation" })).toHaveAttribute("aria-expanded", "false");
    await expect(reloadedSidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toBeVisible();
    await expect(reloadedSidebar.getByText("Today", { exact: true })).toHaveCount(0);
  });

  test("search filters threads to matches, with an empty state", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator('aside[aria-label="List pane"] .chat-sidebar');
    const search = sidebar.getByRole("searchbox", { name: "Search projects and threads" });

    await search.fill("deploy");
    await expect(sidebar.getByText("Wire deploy pipeline").first()).toBeVisible();
    // Non-matching threads (and their folders) drop out of the filtered view.
    await expect(sidebar.getByText("Refactor auth flow")).toHaveCount(0);

    await search.fill("no-such-session-xyz");
    await expect(sidebar.getByText("No threads match your search")).toBeVisible();
  });

  test("unpinning from the pinned row overflow moves focus to the surviving recent row", async ({ page }) => {
    await gotoChat(page, { pinnedSessionIds: ["s1"] });
    const sidebar = page.locator('aside[aria-label="List pane"] .chat-sidebar');
    const pinnedSection = sidebar.locator('section[aria-label="Pinned threads"]');
    const todaySection = sidebar.locator('section[aria-label="Today"]');

    await expect(pinnedSection.getByText("Refactor auth flow")).toBeVisible();
    await expect(todaySection.getByText("Refactor auth flow")).toBeVisible();

    await pinnedSection.getByRole("button", { name: "Chat actions for Refactor auth flow" }).click();
    await page.getByRole("menuitem", { name: "Unpin" }).click();

    const survivingRowButton = todaySection.locator('[data-row-instance="recent:s1"] .cnav__thread-main');
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(false);
    await expect(survivingRowButton).toBeFocused();
    await expect(sidebar.locator('[data-row-instance="pinned:s1"]')).toHaveCount(0);
  });
});
