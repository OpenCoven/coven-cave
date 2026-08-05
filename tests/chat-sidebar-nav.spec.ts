import { expect, test, type Locator, type Page } from "@playwright/test";

// Verifies Chat mode's WorkspaceSidebar in the Shell nav. It replaces the
// normal SidebarMinimal while Chat is active and defaults to a time-bucketed
// "Recent chats" view (Today / Yesterday / Previous 7 days / Previous 30 days /
// Older). A ⋯ "Sidebar options" button opens an Organize menu (role=dialog)
// with menuitemradio items to switch to "By project" folder grouping. The Shell
// nav owns thread navigation while ChatSurface hides the duplicate internal
// rail. Desktop collapse/expand and the mobile nav drawer are both covered.
// /api/familiars + /api/sessions/list are mocked.

// Timestamps are relative to the test run so bucket labels are deterministic:
// s1 → Today, s2 → Yesterday, s3/s5 → Previous 7 days, s4 → Older.
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const NO_ATTENTION = { state: "none", since: null, reason: null } as const;
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
].map((s) => ({
  ...s,
  harness: "codex",
  familiarId: "nova",
  exit_code: null,
  archived_at: null,
  created_at: s.updated_at,
}));

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

async function narrowChatSidebar(page: Page) {
  const sidebar = page.locator('aside[aria-label="Sidebar"] .chat-sidebar');
  const cnav = sidebar.locator(".cnav");
  await cnav.evaluate((element) => {
    const nav = element as HTMLElement;
    const host = nav.closest<HTMLElement>(".chat-sidebar");
    if (host) {
      Object.assign(host.style, {
        width: "200px",
        minWidth: "200px",
        maxWidth: "200px",
      });
    }
    Object.assign(nav.style, {
      width: "200px",
      minWidth: "200px",
      maxWidth: "200px",
    });
  });
  await expect.poll(async () => (await cnav.boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(212);
}

async function ensureChatSurface(page: Page) {
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  const surface = page.locator(".chat-surface");
  try {
    await surface.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const chatDestination = page
      .locator('aside[aria-label="Sidebar"]')
      .getByRole("button", { name: /^Chat\b/ })
      .first();
    if (!(await chatDestination.isVisible().catch(() => false))) {
      const openNav = page.getByRole("button", { name: "Open navigation (⌘B)" });
      if (await openNav.isVisible().catch(() => false)) await openNav.click();
    }
    await chatDestination.click();
    await surface.waitFor({ state: "visible", timeout: 30_000 });
  }
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

    await page.keyboard.press("ControlOrMeta+b");
    await expect(search).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse Chat sidebar" })).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cave:shell:nav-open"))).toBe("1");
  });

  test("defaults to the Recent view; grouping tabs switch to project folders", async ({ page }) => {
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
    await expect(sidebar.locator(".cnav__time").filter({ hasText: /\bago\b/ })).toHaveCount(0);

    // The sidebar-owned grouping tabs replace the old Organize menu choice.
    const groupingTabs = sidebar.getByRole("tablist", { name: "Group chats" });
    await expect(groupingTabs.getByRole("tab", { name: "Recent" })).toHaveAttribute("aria-selected", "true");
    await groupingTabs.getByRole("tab", { name: "Projects" }).click();
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

  test("narrow chat nav keeps the attention label rendered after the project tile collapses", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator('aside[aria-label="Sidebar"] .chat-sidebar');
    const attentionRow = sidebar.locator(".cnav__thread", { hasText: "Approve release checklist" }).first();
    const attentionButton = attentionRow.locator("button.cnav__thread-main");
    const projectTile = attentionRow.locator(".cnav__thread-proj");
    const attentionCue = attentionRow.locator(".cnav__attention");
    const attentionLabel = attentionCue.locator("span:not(.cnav__attention-dot)").first();

    await expect(sidebar.getByRole("heading", { name: "Awaiting you" })).toHaveCount(0);
    await expect(sidebar.locator('section[aria-label="Awaiting you"]')).toBeVisible();
    await expect(attentionRow.getByText("Approve release checklist", { exact: true })).toBeVisible();
    await expect(projectTile).toBeVisible();
    await expect(attentionCue).toBeVisible();
    await expect(attentionLabel).toHaveText("Awaiting you");
    await expect(attentionButton).toHaveAccessibleName(/Approve release checklist[\s\S]*Awaiting you/);

    await narrowChatSidebar(page);

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
    await expect(attentionButton).toHaveAccessibleName(/Approve release checklist[\s\S]*Awaiting you/);
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
