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

  test("(e) Files tab → project tree + read-only preview", async ({ page }) => {
    const filesRef = { count: 0 };
    await routeChanges(page, filesRef);
    // Mock the file tree: a single readme file at the project root.
    await page.route("**/api/project-tree**", (route) =>
      route.fulfill({
        json: {
          ok: true,
          entries: [{ name: "README.md", path: "/repo/alpha/README.md", isDir: false }],
        },
      }),
    );
    // Mock the read-only preview payload for that file.
    await page.route("**/api/project-file**", (route) =>
      route.fulfill({
        json: { ok: true, kind: "text", content: "# Alpha\n\nHello world.", size: 22 },
      }),
    );

    await base(page, [REPO_SESSION]);
    await openSession(page, "Refactor auth flow");

    const rail = page.locator(".workspace-rail");
    await expect(rail).toBeVisible({ timeout: 30_000 });

    // Switch to the Files tab — the placeholder is gone and the tree appears.
    await rail.getByRole("button", { name: "Files" }).click();
    await expect(rail.locator(".workspace-rail__files")).toBeVisible();
    await expect(rail.locator(".workspace-rail__soon")).toHaveCount(0);
    await expect(rail.locator('[role="tree"]')).toBeVisible({ timeout: 15_000 });

    // Empty preview until a file is picked, then read-only content renders.
    await expect(rail.locator(".workspace-rail__files-empty")).toBeVisible();
    await rail.getByText("README.md", { exact: false }).first().click();
    await expect(rail.locator(".workspace-rail__preview")).toBeVisible({ timeout: 15_000 });
    await expect(rail.locator(".workspace-rail__preview-name")).toContainText("README.md");
  });

  // PR 3 / Task 3: below the mobile breakpoint there's no room for the
  // third-column rail Panel, so the rail is presented as a right-edge
  // slide-over sheet opened by an explicit toggle button. Desktop-project runs
  // must NOT see the toggle (the Panel path owns the rail there); mobile
  // projects (pixel-5 / iphone-13) must.
  test("(g) desktop → no mobile rail toggle (third-column Panel path owns it)", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only");
    const filesRef = { count: 0 };
    await routeChanges(page, filesRef);
    await base(page, [REPO_SESSION]);
    await openSession(page, "Refactor auth flow");
    // Rail is the third-column Panel on desktop…
    await expect(page.locator(".workspace-rail")).toBeVisible({ timeout: 30_000 });
    // …and the mobile toggle affordance is absent.
    await expect(page.locator(".mobile-code-rail-toggle")).toHaveCount(0);
  });

  // The mobile slide-over-sheet path lives in tests/mobile/code-rail-sheet.spec.ts
  // because Playwright's mobile projects (pixel-5 / iphone-13) only match specs
  // under tests/mobile/ (see playwright.config.ts testMatch). A mobile-only test
  // placed here would only ever run under the desktop project and self-skip.

  test("(f) Terminal tab → lazy pty host (not mounted until first opened)", async ({ page }) => {
    const filesRef = { count: 0 };
    await routeChanges(page, filesRef);

    await base(page, [REPO_SESSION]);
    await openSession(page, "Refactor auth flow");

    const rail = page.locator(".workspace-rail");
    await expect(rail).toBeVisible({ timeout: 30_000 });

    // The Terminal tab button exists…
    const terminalTab = rail.getByRole("button", { name: "Terminal" });
    await expect(terminalTab).toBeVisible();

    // …but its host container is ABSENT before the first click (genuine
    // laziness — the pty must not start early).
    await expect(rail.locator(".workspace-rail__terminal")).toHaveCount(0);

    // Clicking Terminal mounts the host wrapper. In daemon-less e2e there is no
    // live pty websocket bridge, so we assert the host wrapper mounts (not a
    // working shell) and that the "next step" placeholder is gone.
    await terminalTab.click();
    await expect(rail.locator(".workspace-rail__terminal")).toBeVisible({ timeout: 15_000 });
    await expect(rail.locator(".workspace-rail__soon")).toHaveCount(0);
  });
});
