import { expect, test, type Page } from "@playwright/test";

// Verifies the chat-mode left sidebar (ChatSidebar) — the desktop session
// navigator that swaps into the nav slot when you enter Chat (⌘2), mirroring
// how Code mode swaps in the CodeSidebar. It groups sessions under their
// project folders (expanded by default) and filters them with a search box.
// The in-surface thread rail is dropped in chat mode (the sidebar owns thread
// navigation now). Desktop only. /api/familiars + /api/sessions/list are mocked.

const ISO = "2026-06-12T10:00:00.000Z";
const SESSIONS = [
  { id: "s1", title: "Refactor auth flow", status: "running", origin: "chat", project_root: "/repo/alpha" },
  { id: "s2", title: "Fix eslint config", status: "completed", origin: "board", project_root: "/repo/alpha" },
  { id: "s3", title: "Write API docs", status: "completed", origin: "chat", project_root: "/repo/beta" },
  { id: "s4", title: "Wire deploy pipeline", status: "running", origin: "board", project_root: "/repo/beta" },
].map((s) => ({
  ...s,
  harness: "codex",
  familiarId: "nova",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
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
  test("groups every session under its project folder, with a search box", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator(".chat-sidebar");

    // Search control (an <input type="search"> → searchbox role).
    await expect(sidebar.getByRole("searchbox", { name: "Search chat projects and threads" })).toBeVisible();

    // One folder per project root (basename), expanded by default. Target the
    // folder toggle (aria-label "Collapse/Expand <name> threads"), not the
    // per-folder "New chat in <name>" button which also contains the name.
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) beta threads/ })).toBeVisible();

    // Every session is visible in its project group — expanded by default.
    for (const s of SESSIONS) {
      await expect(sidebar.getByText(s.title, { exact: false }).first()).toBeVisible();
    }
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
