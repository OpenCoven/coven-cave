import { expect, test, type Page } from "@playwright/test";

// Verifies the chat thread rail (chat-project-sidebar) — the desktop session
// navigator reached via ⌘2. The rail groups sessions under their project
// folders (expanded), exposes an "All sessions" scope and a session search that
// surfaces a flat "Results" section. Desktop only — the rail is `hidden lg:flex`.
// /api/familiars + /api/sessions/list are mocked for determinism.

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
  await page.waitForSelector(".chat-thread-rail", { timeout: 30_000 });
}

test.describe("chat thread rail (session navigator)", () => {
  test("groups every session under its project with all-sessions + search controls", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(".chat-thread-rail");

    // Scope + search controls.
    await expect(rail.getByRole("button", { name: "All sessions" })).toBeVisible();
    await expect(rail.getByRole("textbox", { name: "Search sessions" })).toBeVisible();

    // One folder per project root (basename), expanded by default. Target the
    // folder toggle (aria-label "Collapse/Expand <name> sessions"), not the
    // per-folder "New session in <name>" button which also contains the name.
    await expect(rail.getByRole("button", { name: /(Collapse|Expand) alpha sessions/ })).toBeVisible();
    await expect(rail.getByRole("button", { name: /(Collapse|Expand) beta sessions/ })).toBeVisible();

    // Every session is visible in its project group — no expansion needed.
    for (const s of SESSIONS) {
      await expect(rail.getByText(s.title, { exact: false }).first()).toBeVisible();
    }
  });

  test("search surfaces matching sessions in a Results section, with an empty state", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(".chat-thread-rail");
    const search = rail.getByRole("textbox", { name: "Search sessions" });

    await search.fill("deploy");
    await expect(rail.getByText("Results")).toBeVisible();
    await expect(rail.getByText("Wire deploy pipeline").first()).toBeVisible();

    await search.fill("no-such-session-xyz");
    await expect(rail.getByText("No sessions match your search")).toBeVisible();
  });
});
