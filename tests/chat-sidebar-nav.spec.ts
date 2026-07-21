import { expect, test, type Page } from "@playwright/test";

// Verifies Chat mode's WorkspaceSidebar in the Shell nav. It replaces the
// normal SidebarMinimal while Chat is active and defaults to a time-bucketed
// "Recent chats" view (Today / Yesterday / Previous 7 days / Previous 30 days /
// Older). A ⋯ "Sidebar options" button opens an Organize menu (role=dialog)
// with menuitemradio items to switch to "By project" folder grouping. The Shell
// nav owns thread navigation while ChatSurface hides the duplicate internal
// rail. Desktop collapse/expand and the mobile nav drawer are both covered.
// /api/familiars + /api/sessions/list are mocked.

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
  await page.waitForSelector('aside[aria-label="Sidebar"] .chat-sidebar', { timeout: 30_000 });
}

async function gotoChat(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // Seed the remembered normal-nav preference OPEN. Chat owns a separate
    // contextual nav layout and must not overwrite that outside-Chat preference.
    window.localStorage.setItem("cave:shell:nav-open", "1");
  });
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
  test("desktop nav toggle and Command-B fully hide and restore the Chat sidebar", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator('aside[aria-label="Sidebar"] .chat-sidebar');
    const nav = page.locator('aside[aria-label="Sidebar"]');
    const search = sidebar.getByRole("searchbox", { name: "Search projects and threads" });
    const collapseToggle = page.getByRole("button", { name: "Collapse Chat sidebar" });

    // WorkspaceSidebar is the contextual primary nav in Chat.
    await expect(sidebar).toBeVisible();
    await expect(search).toBeVisible();
    await expect(nav).toBeVisible();
    await expect(nav.locator(".chat-sidebar")).toHaveCount(1);
    await expect(page.locator('aside[aria-label="List pane"]')).toHaveCount(0);
    await expect(page.locator(".chat-thread-rail")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cave:shell:nav-open"))).toBe("1");
    await expect(collapseToggle).toHaveAttribute("aria-expanded", "true");

    await collapseToggle.click();
    const expandToggle = page.getByRole("button", { name: "Expand Chat sidebar" });
    await expect(expandToggle).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).toBeHidden();

    await page.keyboard.press("Meta+b");
    await expect(search).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse Chat sidebar" })).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cave:shell:nav-open"))).toBe("1");
  });

  test("defaults to the Recent view; Organize menu switches to project folders", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator('aside[aria-label="Sidebar"] .chat-sidebar');

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
    const reloadedSidebar = page.locator('aside[aria-label="Sidebar"] .chat-sidebar');
    await expect(page.getByRole("button", { name: "Collapse Chat sidebar" })).toHaveAttribute("aria-expanded", "true");
    await expect(reloadedSidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toBeVisible();
    await expect(reloadedSidebar.getByText("Today", { exact: true })).toHaveCount(0);
  });

  test("search filters threads to matches, with an empty state", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator('aside[aria-label="Sidebar"] .chat-sidebar');
    const search = sidebar.getByRole("searchbox", { name: "Search projects and threads" });

    await search.fill("deploy");
    await expect(sidebar.getByText("Wire deploy pipeline").first()).toBeVisible();
    // Non-matching threads (and their folders) drop out of the filtered view.
    await expect(sidebar.getByText("Refactor auth flow")).toHaveCount(0);

    await search.fill("no-such-session-xyz");
    await expect(sidebar.getByText("No threads match your search")).toBeVisible();
  });
});

test.describe("chat sidebar on mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens and dismisses the contextual nav drawer without a list drawer", async ({ page }) => {
    await gotoChat(page);
    const shell = page.locator(".shell-root");
    const sidebar = page.locator('aside[aria-label="Sidebar"] .chat-sidebar');
    const search = sidebar.getByRole("searchbox", { name: "Search projects and threads" });
    const openNav = page.getByRole("button", { name: "Open navigation (⌘B)" });

    await expect(openNav).toBeVisible();
    await expect(openNav).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /Open list|Close list/ })).toHaveCount(0);
    await expect(page.locator('aside[aria-label="List pane"]')).toHaveCount(0);
    await expect(shell).not.toHaveAttribute("data-mobile-drawer");

    await openNav.click();
    await expect(shell).toHaveAttribute("data-mobile-drawer", "nav");
    await expect(page.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");
    await expect(search).toBeVisible();
    const backdrop = page.locator('.mobile-drawer-backdrop[data-drawer-slot="nav"]');
    await expect(backdrop).toBeVisible();

    await backdrop.click({ position: { x: 380, y: 420 } });
    await expect(shell).not.toHaveAttribute("data-mobile-drawer");
    await expect(page.getByRole("button", { name: "Open navigation (⌘B)" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".mobile-drawer-backdrop")).toHaveCount(0);
  });
});
