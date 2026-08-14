import { expect, test, type Page } from "@playwright/test";

// Compile the code-split surface chunks ONCE, serially, before the parallel
// projects run (cave-ct2k7).
//
// WHY THIS EXISTS. The heavy surfaces in `@/components/lazy-surfaces` are
// `next/dynamic` chunks, so the browser fetches each one on FIRST open — and
// under `next dev` that fetch is a Turbopack compile, not a static file read.
// The first test to open such a surface therefore pays the whole cold compile
// inside its own assertion budget, and whichever test that happens to be is
// the one that flakes:
//
//   keyboard-shortcuts.spec.ts:44  — ⌘K, waiting on the `command-palette` chunk
//   task-work-fit.spec.ts:277      — reopen strip, waiting on `workspace-rail`
//
// Measured in this worktree (2026-08-12, M-series laptop):
//
//   warm .next, any worker count     — 2-3s     (passes comfortably)
//   cold .next, 1 worker             — 28.3s    (passes; the poll budget is 30s)
//   cold .next, 4 workers            — >30s     (fails)
//
// CI is cold on every run, so those tests sit right at the boundary and rotate
// between "flaky" (saved by the retry, which runs warm) and "failed". Note the
// cost is NOT the surface under test: `command-palette` renders `loading: null`
// while its chunk compiles, so the page looks exactly as it does when the
// shortcut never fired. That is why this reads as a mysterious dead keybinding
// rather than a slow one.
//
// Raising the individual timeouts would only make each spec fail slower and
// leave the next lazy surface to rediscover the same cliff. Paying the compile
// once, here, in a serial project every other project depends on, removes the
// racing input instead: by the time the parallel projects start, every chunk
// below is already built.
//
// This file is `.setup.ts`, not `.spec.ts`, so the ordinary projects' testMatch
// (`/.*\.spec\.ts/`) never picks it up as a test of its own.

const ISO = "2026-06-12T10:00:00.000Z";

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

// A repo-linked session is what makes the code rail available at all.
const REPO_SESSION = {
  id: "s-repo",
  title: "Warmup session",
  status: "running",
  origin: "chat",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local",
  project_root: "/repo/alpha",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

const REPO_PROJECT = {
  id: "repo-alpha",
  name: "alpha",
  root: "/repo/alpha",
  access: "write",
  createdAt: ISO,
  updatedAt: ISO,
};

// Four times the cold serial measurement above. A chunk that cannot compile in
// two minutes is a genuine dev-server problem, and failing here says so once
// rather than leaving every spec to time out on its own.
const CHUNK_TIMEOUT = 120_000;

async function boot(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:code-rail:pinned:v1", "false");
    // Nav is minimized-by-default; keep it expanded so the rail keeps its room.
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [REPO_SESSION] } }),
  );
  await page.route("**/api/projects**", (route) =>
    route.fulfill({ json: { ok: true, projects: [REPO_PROJECT] } }),
  );
  await page.route("**/api/changes**", (route) =>
    route.fulfill({ json: { ok: true, repo: true, repoRoot: "/repo/alpha", files: [] } }),
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

  await page.goto("/?mode=chat");
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: CHUNK_TIMEOUT });
}

test("warm the code-split surface chunks", async ({ page }) => {
  // The whole point is to absorb a cold compile, so this one test gets a budget
  // no ordinary spec should ever need.
  test.setTimeout(600_000);

  await boot(page);

  // `command-palette` — the chunk keyboard-shortcuts.spec.ts waits on through
  // its ⌘K readiness poll. Poll rather than press once: before the Workspace
  // effect attaches, the keypress lands on nothing at all.
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.mouse.click(5, 5);
  await expect
    .poll(
      async () => {
        await page.keyboard.press("Meta+k");
        return palette.isVisible();
      },
      { timeout: CHUNK_TIMEOUT, message: "command-palette chunk should compile and open" },
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  // `shortcuts-sheet` — the surface those specs actually assert on.
  await page.mouse.click(5, 5);
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: /Keyboard shortcuts/ });
  await expect(sheet).toBeVisible({ timeout: CHUNK_TIMEOUT });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // `workspace-rail` — the chunk task-work-fit.spec.ts waits on after clicking
  // the reopen strip. Reached here from chat rather than the board cockpit;
  // it is the same lazy component either way, and this path needs no bridge.
  await page.locator(".chat-sidebar").getByText("Warmup session", { exact: false }).first().click();
  const reopen = page.locator(".workspace-rail-reopen");
  await expect(reopen).toBeVisible({ timeout: CHUNK_TIMEOUT });
  await reopen.click();
  await expect(page.locator(".workspace-rail")).toBeVisible({ timeout: CHUNK_TIMEOUT });
});
