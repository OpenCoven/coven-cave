import { expect, test, type Page } from "@playwright/test";

// PR 1 / Task 4: the code rail (WorkspaceRail) auto-reveals beside the chat
// conversation on the standalone chat surface when the active session is
// repo-linked, tracks the pending-edit count from /api/changes (re-polled on
// the cave:changes-refresh edit signal), and collapses to a slim reopen strip.
// Daemon-less — onboarding dismissed, all endpoints mocked via page.route.

const ISO = "2026-06-12T10:00:00.000Z";

const mkSession = (over: Record<string, unknown>) => ({
  status: "running",
  origin: "chat",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
  ...over,
});

// A repo-linked session (rail available) and a plain session (no project_root).
const REPO_SESSION = mkSession({ id: "s-repo", title: "Refactor auth flow", project_root: "/repo/alpha" });
const PLAIN_SESSION = mkSession({ id: "s-plain", title: "Brainstorm ideas", project_root: "" });

async function base(page: Page, sessions: unknown[]) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // Keep the rail unpinned so its default open/collapse behaviour is exercised.
    window.localStorage.setItem("cave:code-rail:pinned:v1", "false");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: { turns: [{ id: "t1", role: "assistant", text: "On it.", createdAt: ISO }] },
        context: {},
      },
    }),
  );
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
}

// Mock /api/changes with a mutable file count so the test can flip 0 → N.
async function routeChanges(page: Page, filesRef: { count: number }) {
  await page.route("**/api/changes**", (route) => {
    const files = Array.from({ length: filesRef.count }, (_, i) => ({
      path: `src/file-${i}.ts`,
      status: "modified",
    }));
    route.fulfill({ json: { ok: true, repo: true, repoRoot: "/repo/alpha", files } });
  });
}

async function openSession(page: Page, title: string) {
  await page.locator(".chat-sidebar").getByText(title, { exact: false }).first().click();
}

test.describe("code rail beside chat", () => {
  test("(a) plain chat with no project_root → no code rail", async ({ page }) => {
    const filesRef = { count: 0 };
    await routeChanges(page, filesRef);
    await base(page, [PLAIN_SESSION]);
    await openSession(page, "Brainstorm ideas");
    // Give the hash-derivation + rail resolution a beat to settle.
    await page.waitForTimeout(800);
    await expect(page.locator(".workspace-rail")).toHaveCount(0);
  });

  test("(b) repo session → rail visible; (c) edit signal reveals Changes badge; (d) collapse → reopen strip", async ({ page }) => {
    const filesRef = { count: 0 };
    await routeChanges(page, filesRef);
    await base(page, [REPO_SESSION]);
    await openSession(page, "Refactor auth flow");

    // (b) The rail auto-reveals for a repo-linked session even with no edits.
    const rail = page.locator(".workspace-rail");
    await expect(rail).toBeVisible({ timeout: 30_000 });

    // (c) A fresh edit batch (2 files) arrives via the cave:changes-refresh
    // signal → the Changes tab badge shows 2.
    filesRef.count = 2;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:changes-refresh")));
    await expect(rail.locator(".workspace-rail__badge")).toHaveText("2", { timeout: 15_000 });

    // (d) Collapsing hides the rail and surfaces the slim reopen strip.
    await rail.getByRole("button", { name: "Collapse code rail" }).click();
    await expect(page.locator(".workspace-rail")).toHaveCount(0);
    const reopen = page.locator(".workspace-rail-reopen");
    await expect(reopen).toBeVisible();

    // And the strip reopens the rail.
    await reopen.click();
    await expect(page.locator(".workspace-rail")).toBeVisible();
  });
});
