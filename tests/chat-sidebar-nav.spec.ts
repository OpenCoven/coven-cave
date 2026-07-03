import { expect, test, type Page } from "@playwright/test";

// Verifies the chat-mode left sidebar (ChatSidebar) — the desktop session
// navigator that swaps into the nav slot when you enter Chat (⌘2). Defaults
// to a time-bucketed "Recent chats" view (Today / Yesterday / Previous 7 days /
// Previous 30 days / Older). A ⋯ "Sidebar options" button opens an Organize
// menu (role=dialog) with menuitemradio items to switch to "By project" folder
// grouping. The sidebar owns thread navigation (no in-surface thread rail).
// Desktop only. /api/familiars + /api/sessions/list are mocked.

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

async function gotoChat(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  );
  await page.goto("/");
  // Switch to the Chat surface (⌘2) — default landing is Home.
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.waitForSelector(".chat-sidebar", { timeout: 30_000 });
}

test.describe("chat sidebar (session navigator)", () => {
  test("defaults to the Recent view; Organize menu switches to project folders", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator(".chat-sidebar");

    // Search control survives in both views.
    await expect(sidebar.getByRole("searchbox", { name: "Search chat projects and threads" })).toBeVisible();

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
    await page.keyboard.press("Meta+2");
    await page.waitForSelector(".chat-sidebar", { timeout: 30_000 });
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toBeVisible();
    await expect(sidebar.getByText("Today", { exact: true })).toHaveCount(0);
  });

  test("search filters threads to matches, with an empty state", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator(".chat-sidebar");
    const search = sidebar.getByRole("searchbox", { name: "Search chat projects and threads" });

    await search.fill("deploy");
    await expect(sidebar.getByText("Wire deploy pipeline").first()).toBeVisible();
    // Non-matching threads (and their folders) drop out of the filtered view.
    await expect(sidebar.getByText("Refactor auth flow")).toHaveCount(0);

    await search.fill("no-such-session-xyz");
    await expect(sidebar.getByText("No threads match your search")).toBeVisible();
  });
});
