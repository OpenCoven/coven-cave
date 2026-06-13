import { expect, test, type Page } from "@playwright/test";

// Verifies the Codex-style chat thread rail (chat-project-sidebar) renders
// every chat flat, exposes the mode filters, and launches new chats.
// Desktop only — the rail is `hidden lg:flex`. Demo mode supplies familiars;
// /api/sessions/list is mocked so the rail content is deterministic.

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
    window.localStorage.setItem("cave:demo-mode", "1");
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
  });
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  );
  await page.goto("/?demo=1");
  // Switch to the Chat surface (⌘2) — default landing is Home.
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.waitForSelector(".chat-thread-rail", { timeout: 30_000 });
}

test.describe("chat thread rail (Codex-style visibility)", () => {
  test("lists every chat flat with mode filters and a New launcher", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(".chat-thread-rail");

    // Every session is visible in the flat list — no folder expansion needed.
    for (const s of SESSIONS) {
      await expect(rail.getByText(s.title, { exact: false }).first()).toBeVisible();
    }

    // Mode filter chips exist (All / Active / Tasks / Pinned).
    for (const label of ["All", "Active", "Tasks", "Pinned"]) {
      await expect(rail.getByRole("tab", { name: new RegExp(label) })).toBeVisible();
    }

    // Prominent New launcher.
    await expect(rail.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
  });

  test("Active filter narrows to running chats; Tasks to board-originated", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(".chat-thread-rail");

    await rail.getByRole("tab", { name: /Active/ }).click();
    await expect(rail.getByText("Refactor auth flow")).toBeVisible(); // running
    await expect(rail.getByText("Wire deploy pipeline")).toBeVisible(); // running
    await expect(rail.getByText("Fix eslint config")).toHaveCount(0); // completed
    await expect(rail.getByText("Write API docs")).toHaveCount(0); // completed

    await rail.getByRole("tab", { name: /Tasks/ }).click();
    await expect(rail.getByText("Fix eslint config")).toBeVisible(); // board
    await expect(rail.getByText("Wire deploy pipeline")).toBeVisible(); // board
    await expect(rail.getByText("Refactor auth flow")).toHaveCount(0); // chat origin
  });

  test("search filters the flat list by title", async ({ page }) => {
    await gotoChat(page);
    const rail = page.locator(".chat-thread-rail");
    await rail.getByRole("textbox", { name: "Search chats" }).fill("deploy");
    await expect(rail.getByText("Wire deploy pipeline")).toBeVisible();
    await expect(rail.getByText("Refactor auth flow")).toHaveCount(0);
  });
});
