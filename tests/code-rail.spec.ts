import { expect, test, type Page } from "@playwright/test";

// The code rail (WorkspaceRail) rests CLOSED beside the chat conversation
// (cave-xsq.7 — the conversation owns the pane); a repo-linked session shows
// the slim reopen strip instead. The rail opens on demand (strip / pin /
// explicit focus target) and auto-reveals only on a genuinely observed 0→N
// edit batch from /api/changes (re-polled on the cave:changes-refresh signal).
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
    // Nav is minimized-by-default; keep it expanded so the code rail keeps its
    // room (a rail-width nav narrows the multi-pane chat layout).
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
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

  test("(b) repo session → rail rests closed with the reopen strip; (c) a fresh 0→N edit batch auto-reveals with the Changes badge; (d) collapse → reopen strip", async ({ page }) => {
    const filesRef = { count: 0 };
    await routeChanges(page, filesRef);
    await base(page, [REPO_SESSION]);
    await openSession(page, "Refactor auth flow");

    // (b) Closed by default (cave-xsq.7): a repo-linked session offers the slim
    // reopen strip, but the conversation owns the pane — no rail at rest.
    const reopen = page.locator(".workspace-rail-reopen");
    await expect(reopen).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".workspace-rail")).toHaveCount(0);

    // (c) A genuinely observed fresh edit batch (the mocked count was a real 0,
    // now 2 files arrive via the cave:changes-refresh signal) AUTO-REVEALS the
    // rail with the Changes tab badge showing 2.
    const rail = page.locator(".workspace-rail");
    filesRef.count = 2;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:changes-refresh")));
    await expect(rail).toBeVisible({ timeout: 15_000 });
    await expect(rail.locator(".workspace-rail__badge")).toHaveText("2", { timeout: 15_000 });

    // (d) Collapsing hides the rail and surfaces the slim reopen strip.
    await rail.getByRole("button", { name: "Collapse code rail" }).click();
    await expect(page.locator(".workspace-rail")).toHaveCount(0);
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

    // Closed at rest (cave-xsq.7) — open the rail via the reopen strip.
    await page.locator(".workspace-rail-reopen").click({ timeout: 30_000 });
    const rail = page.locator(".workspace-rail");
    await expect(rail).toBeVisible({ timeout: 15_000 });

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

    // Expanded Files tab should behave like an IDE: file tree left, open file
    // in the main/code pane, and worktree diffs/changes on the far right.
    await rail.getByRole("button", { name: "Expand code rail fullscreen" }).click();
    await expect(rail).toHaveAttribute("data-fullscreen", "true");
    await expect(rail.locator(".workspace-rail__files--ide")).toBeVisible();
    const treePane = rail.locator(".workspace-rail__files-tree-pane");
    const editorPane = rail.locator(".workspace-rail__files-editor");
    const diffsPane = rail.locator(".workspace-rail__files-diffs");
    await expect(treePane).toBeVisible();
    await expect(editorPane).toBeVisible();
    await expect(diffsPane).toBeVisible();
    await expect(editorPane.locator(".workspace-rail__preview-name")).toContainText("README.md");
    await expect(diffsPane.getByText("Worktree")).toBeVisible({ timeout: 15_000 });
    const treeBox = await treePane.boundingBox();
    const editorBox = await editorPane.boundingBox();
    const diffsBox = await diffsPane.boundingBox();
    expect(treeBox && editorBox && diffsBox).toBeTruthy();
    expect(treeBox!.x).toBeLessThan(editorBox!.x);
    expect(editorBox!.x).toBeLessThan(diffsBox!.x);
    expect(treeBox!.width).toBeGreaterThan(180);
    expect(diffsBox!.width).toBeGreaterThan(220);
    expect(editorBox!.width).toBeGreaterThan(treeBox!.width);
    expect(editorBox!.width).toBeGreaterThan(diffsBox!.width);

    // The expanded panel can collapse back to the compact chat/code rail.
    await rail.getByRole("button", { name: "Exit code rail fullscreen" }).click();
    await expect(rail).not.toHaveAttribute("data-fullscreen", "true");
    await expect(rail.locator(".workspace-rail__files--ide")).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Terminal" })).toHaveCount(0);
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
    // Closed at rest (cave-xsq.7) — the strip reopens the third-column Panel…
    await page.locator(".workspace-rail-reopen").click({ timeout: 30_000 });
    await expect(page.locator(".workspace-rail")).toBeVisible({ timeout: 15_000 });
    // …and the mobile toggle affordance is absent on desktop.
    await expect(page.locator(".mobile-code-rail-toggle")).toHaveCount(0);
  });

  // The mobile slide-over-sheet path lives in tests/mobile/code-rail-sheet.spec.ts
  // because Playwright's mobile projects (pixel-5 / iphone-13) only match specs
  // under tests/mobile/ (see playwright.config.ts testMatch). A mobile-only test
  // placed here would only ever run under the desktop project and self-skip.

  test("(f) Terminal tab → fullscreen-only lazy pty host", async ({ page }) => {
    const filesRef = { count: 0 };
    await routeChanges(page, filesRef);

    await base(page, [REPO_SESSION]);
    await openSession(page, "Refactor auth flow");

    // Closed at rest (cave-xsq.7) — open the rail via the reopen strip.
    await page.locator(".workspace-rail-reopen").click({ timeout: 30_000 });
    const rail = page.locator(".workspace-rail");
    await expect(rail).toBeVisible({ timeout: 15_000 });

    // The normal side rail has Changes/Files only; Terminal is reserved for
    // the user-expanded fullscreen rail.
    await expect(rail.getByRole("button", { name: "Terminal" })).toHaveCount(0);
    await expect(rail.locator(".workspace-rail__terminal")).toHaveCount(0);

    await rail.getByRole("button", { name: "Expand code rail fullscreen" }).click();
    await expect(rail).toHaveAttribute("data-fullscreen", "true");

    // The Terminal tab button appears only after fullscreen expansion…
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

  test("(g) Changes tab Review button starts a new session carrying the commit-review prompt", async ({ page }) => {
    const filesRef = { count: 2 };
    await routeChanges(page, filesRef);

    // Capture the auto-sent opening prompt of the review session. The button
    // dispatches cave:agents-new-chat; ChatSurface opens a NEW chat whose
    // initialPrompt auto-sends through /api/chat/send — the honest end of the
    // wire. Reply with a minimal SSE stream so the chat settles.
    const sends: Array<{ prompt?: string }> = [];
    await page.route("**/api/chat/send", (route) => {
      sends.push(JSON.parse(route.request().postData() ?? "{}"));
      route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"type":"done"}\n\n',
      });
    });

    await base(page, [REPO_SESSION]);
    await openSession(page, "Refactor auth flow");

    await page.locator(".workspace-rail-reopen").click({ timeout: 30_000 });
    const rail = page.locator(".workspace-rail");
    await expect(rail).toBeVisible({ timeout: 15_000 });

    await rail.getByRole("button", { name: "Changes" }).click();
    const review = rail.getByRole("button", { name: "Review changes in a new session" });
    await expect(review).toBeVisible({ timeout: 15_000 });
    await expect(review).toBeEnabled();

    await review.click();

    // Background work (for example, the daily journal narrative) may share the
    // chat endpoint, so wait for the review send rather than assuming it is the
    // first request captured by this route.
    await expect
      .poll(
        () => sends.find(({ prompt }) => prompt?.includes("Review the uncommitted changes in /repo/alpha"))?.prompt,
        { timeout: 15_000 },
      )
      .toBeTruthy();
    const prompt =
      sends.find(({ prompt }) => prompt?.includes("Review the uncommitted changes in /repo/alpha"))?.prompt ?? "";
    expect(prompt).toContain("Review the uncommitted changes in /repo/alpha");
    expect(prompt).toContain("Changed files (2):");
    expect(prompt).toContain("src/file-0.ts");
    expect(prompt).toContain("git diff");
  });
});
