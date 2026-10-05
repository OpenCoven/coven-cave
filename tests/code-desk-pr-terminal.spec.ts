import { expect, test, type Page } from "@playwright/test";

// The Coding Desk's PR tab, full PR view and terminal drawer: the seventh
// review's Medium findings (#5795).
//
//   8.  the PR tab follows the session's PR when it changes on the same mount
//   18. a merge from the PR tab says so, and isn't offered again
//   19. legacy commit statuses are listed, counted, and hold the full view's gate
//   20. threads that couldn't all be read say so, with a way to GitHub
//   27. desk shells are capped: the least recently used session's are stopped
//
// Daemon-less — onboarding dismissed, every endpoint mocked via page.route.
// Helpers copied from tests/code-desk.spec.ts.

const OLD_ISO = "2026-06-12T10:00:00.000Z";
const NEW_ISO = "2026-06-12T12:00:00.000Z";
const WORK_ROOT = "/repo/alpha/.worktrees/feat-flux";

const mkSession = (over: Record<string, unknown>) => ({
  status: "running",
  origin: "chat",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local",
  exit_code: null,
  archived_at: null,
  created_at: OLD_ISO,
  updated_at: OLD_ISO,
  ...over,
});

const NEWEST = mkSession({
  id: "s-new",
  title: "Wire the flux capacitor",
  project_root: "/repo/alpha",
  updated_at: NEW_ISO,
  familiarWorkspace: false,
  workBranch: "feat/flux",
  git: {
    branch: "feat/flux",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: WORK_ROOT,
    isWorktree: true,
  },
  // Resolved from the session's work branch, so review and merge are offered.
  pullRequest: { repo: "acme/alpha", number: 7, url: "https://github.com/acme/alpha/pull/7", state: "open", attribution: "branch" },
  diff: { additions: 12, deletions: 3 },
});
const OLDER = mkSession({
  id: "s-old",
  title: "Fix login retry",
  status: "idle",
  project_root: "/repo/alpha",
  familiarWorkspace: false,
  git: {
    branch: "main",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: "/repo/alpha/.worktrees/fix-login-retry",
    isWorktree: true,
  },
});

const CHANGED_FILES = [
  { path: "src/flux.ts", status: "modified", insertions: 12, deletions: 3, changeVersion: "100:100:400" },
  { path: "src/retry.ts", status: "added", insertions: 5, deletions: 0, changeVersion: "100:100:90" },
];

async function base(page: Page, sessions: unknown[] = [NEWEST, OLDER]) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar-scope", JSON.stringify(["nova"]));
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Orchestrator",
          familiarType: "coding",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }),
  );
  await page.route("**/api/daemon/status**", (route) =>
    route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }),
  );
  await page.route("**/api/daemon/connection**", (route) =>
    route.fulfill({
      json: {
        running: true,
        availability: "online",
        checkedAt: NEW_ISO,
        target: { mode: "local", label: "Local daemon", socket: "/tmp/coven.sock" },
      },
    }),
  );
  await page.route("**/api/onboarding/status**", (route) =>
    route.fulfill({ json: { ok: true, complete: true, steps: {}, tools: [] } }),
  );
  await page.route("**/api/onboarding/update**", (route) =>
    route.fulfill({ json: { ok: true, tools: [], checkedAt: NEW_ISO, stale: false } }),
  );
  await page.route("**/api/onboarding/install**", (route) => route.fulfill({ json: { npmBusy: false } }));
  await page.route("**/api/cave-home-migration**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        status: { pending: [], conflicts: [], migrated: true, details: [], backupRoot: "", journalPath: "" },
      },
    }),
  );
  await page.route("**/api/roles**", (route) => route.fulfill({ json: { ok: true, roles: [] } }));
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions } }));
  await page.route("**/api/changes**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("branches") === "1") {
      route.fulfill({
        json: {
          ok: true,
          branches: [
            { name: "main", current: false, worktree: null },
            { name: "feat/flux", current: true, worktree: "feat-flux", worktreePath: WORK_ROOT },
          ],
        },
      });
      return;
    }
    if (url.searchParams.get("checkpoints") === "1") {
      route.fulfill({ json: { ok: true, checkpoints: [] } });
      return;
    }
    if (url.searchParams.has("path")) {
      const path = url.searchParams.get("path") ?? "file";
      route.fulfill({ json: { ok: true, diff: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n` } });
      return;
    }
    route.fulfill({ json: { ok: true, repo: true, repoRoot: WORK_ROOT, files: CHANGED_FILES } });
  });
  await page.route("**/api/project-tree**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        entries: [
          { name: "README.md", path: `${WORK_ROOT}/README.md`, isDir: false },
          { name: "flux.ts", path: `${WORK_ROOT}/src/flux.ts`, isDir: false },
        ],
      },
    }),
  );
  await page.route("**/api/project-file**", (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    const name = path.slice(path.lastIndexOf("/") + 1);
    route.fulfill({ json: { ok: true, kind: "text", content: `// ${name}\nexport const name = "${name}";\n`, size: 40 } });
  });
  await page.route("**/api/queue/**", (route) => route.fulfill({ json: { ok: true, items: [], prs: [], issues: [], open: [], merged: [], data: [] } }));
}

async function openDesk(page: Page) {
  await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
  const desk = page.getByTestId("code-workbench");
  await expect(desk).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("code-workbench-tree")).toBeVisible({ timeout: 30_000 });
  return desk;
}

const SHA = (c: string) => c.repeat(40);
const run = (id: string, conclusion: string | null = "success", status = "completed") => ({
  id,
  name: id,
  status,
  conclusion,
  startedAt: null,
  completedAt: "2026-06-12T11:00:00Z",
  detailsUrl: null,
});
const threadsOk = {
  ok: true,
  authed: true,
  canResolve: true,
  issueComments: [],
  reviewThreads: [],
  reviews: [],
  reviewEvidenceComplete: true,
  reviewEvidenceError: null,
};

type GitHubMocks = {
  checks: (number: number) => Record<string, unknown>;
  comments?: (number: number) => Record<string, unknown>;
  posts?: { path: string; body: Record<string, unknown> }[];
};

async function githubMocks(page: Page, mocks: GitHubMocks) {
  await page.route("**/api/github/**", (route) => {
    const url = new URL(route.request().url());
    const number = Number(url.searchParams.get("number"));
    if (route.request().method() === "POST") {
      mocks.posts?.push({ path: url.pathname, body: route.request().postDataJSON() });
      return route.fulfill({ json: { ok: true, merged: true, sha: SHA("f") } });
    }
    if (url.pathname.endsWith("/checks")) return route.fulfill({ json: mocks.checks(number) });
    if (url.pathname.endsWith("/comments")) return route.fulfill({ json: mocks.comments?.(number) ?? threadsOk });
    if (url.pathname.endsWith("/item")) {
      return route.fulfill({
        json: {
          ok: true,
          title: "Wire the flux",
          number,
          state: "open",
          merged: false,
          draft: false,
          body: "",
          author: { login: "val", avatarUrl: null },
          createdAt: null,
          htmlUrl: `https://github.com/acme/alpha/pull/${number}`,
          pull: {
            headRef: "feat/flux",
            baseRef: "main",
            headSha: SHA("a"),
            commits: 1,
            additions: 1,
            deletions: 0,
            changedFiles: 1,
            mergeable: true,
            mergeableState: "clean",
            reviews: { approved: 1, changesRequested: 0, commented: 0 },
          },
        },
      });
    }
    return route.fulfill({ json: { ok: true, commits: [], files: [], truncated: false, total: 0 } });
  });
}

async function openPrTab(page: Page) {
  await openDesk(page);
  const rail = page.getByTestId("code-review-rail");
  await rail.getByRole("tab", { name: "Pull request" }).click();
  await expect(rail.locator('section[aria-label="Checks"]')).toBeVisible({ timeout: 30_000 });
  return rail;
}

test.describe.configure({ mode: "serial" });

test.describe("Coding Desk PR tab and terminal (#5795)", () => {
  test("8. when the session's PR changes, the tab drops the old PR's checks, head and armed merge", async ({ page }) => {
    const live = JSON.parse(JSON.stringify(NEWEST)) as Record<string, unknown> & { pullRequest: Record<string, unknown> };
    await base(page, [live, OLDER]);
    const posts: GitHubMocks["posts"] = [];
    await githubMocks(page, {
      posts,
      checks: (number) => ({
        ok: true,
        authed: true,
        sha: number === 7 ? SHA("a") : SHA("b"),
        rollup: "passing",
        runs: [run(`build-${number}`)],
        statuses: [],
      }),
    });
    const rail = await openPrTab(page);
    await expect(rail.getByText("build-7", { exact: true })).toBeVisible();
    // Arm the merge on #7.
    await rail.getByRole("button", { name: "Squash merge" }).click();
    await expect(rail.getByRole("button", { name: "Confirm squash merge" })).toBeVisible();

    // The sessions poll moves the session to #8.
    live.pullRequest = { ...live.pullRequest, number: 8, url: "https://github.com/acme/alpha/pull/8" };
    await expect(rail.getByText("acme/alpha#8")).toBeVisible({ timeout: 25_000 });
    await expect(rail.getByText("build-8", { exact: true })).toBeVisible();
    await expect(rail.getByText("build-7", { exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Confirm squash merge" }), "the confirmation armed on #7 is gone").toHaveCount(0);

    // A merge of #8 is pinned to #8's head.
    await rail.getByRole("button", { name: "Squash merge" }).click();
    await rail.getByRole("button", { name: "Confirm squash merge" }).click();
    await expect.poll(() => posts.find((post) => post.path.endsWith("/merge"))).toBeTruthy();
    expect(posts.find((post) => post.path.endsWith("/merge"))!.body).toMatchObject({ number: 8, headSha: SHA("b") });
  });

  test("18. a merge from the PR tab says it landed, and Squash merge isn't offered again", async ({ page }) => {
    await base(page);
    const posts: GitHubMocks["posts"] = [];
    await githubMocks(page, {
      posts,
      checks: () => ({ ok: true, authed: true, sha: SHA("a"), rollup: "passing", runs: [run("ci")], statuses: [] }),
    });
    const rail = await openPrTab(page);
    // The composer's branch chip listens for this to read the PR again (item 22).
    await page.evaluate(() => {
      const w = window as unknown as { __prChanged: number };
      w.__prChanged = 0;
      window.addEventListener("cave:branch-pr-changed", () => (w.__prChanged += 1));
    });
    await rail.getByRole("button", { name: "Squash merge" }).click();
    await rail.getByRole("button", { name: "Confirm squash merge" }).click();
    await expect(rail.getByRole("status").filter({ hasText: "PR #7 squash-merged." })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __prChanged: number }).__prChanged)).toBe(1);
    // The sessions poll still says "open"; the tab knows better.
    await expect(rail.getByText("merged", { exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: /Squash merge/ })).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(rail.getByText("PR #7 squash-merged.")).toBeVisible();
    await expect(rail.getByRole("button", { name: /Squash merge/ })).toHaveCount(0);
    expect(posts.filter((post) => post.path.endsWith("/merge"))).toHaveLength(1);
  });

  test("19. a failing commit status is listed and counted, and the full PR view's gate holds", async ({ page }) => {
    await base(page);
    await githubMocks(page, {
      checks: () => ({
        ok: true,
        authed: true,
        sha: SHA("a"),
        rollup: "failing",
        runs: [run("job 1"), run("job 2"), run("job 3")],
        statuses: [{ context: "vercel", state: "failure", description: "Deployment failed", targetUrl: null }],
      }),
    });
    const rail = await openPrTab(page);
    const checks = rail.locator('section[aria-label="Checks"]');
    await expect(checks.getByRole("heading")).toContainText("3/4 passed · 1 failed");
    await expect(checks.getByText("vercel", { exact: true })).toBeVisible();
    await expect(checks.locator("li").filter({ hasText: "vercel" })).toContainText(", failure");
    await expect(rail.getByText("Merge is off: checks are failing.")).toBeVisible();

    // The full PR view: the status is on the card, and no gate claims clear.
    await rail.getByRole("button", { name: "Full PR view" }).click();
    const reader = page.getByTestId("github-pr-reader");
    const card = reader.locator('section[aria-label="Checks"]').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Some checks were not successful");
    await expect(card.locator(".pr-reader__check-row").filter({ hasText: "vercel" })).toBeVisible();
    await expect(card.locator(".pr-reader__merge-reason")).toHaveText("Blocked by checks.");
    await expect(card.getByText("Every gate is clear.")).toHaveCount(0);
  });

  test("19b. a repository that reports only statuses shows them, not 0/0 passed", async ({ page }) => {
    await base(page);
    await githubMocks(page, {
      checks: () => ({
        ok: true,
        authed: true,
        sha: SHA("a"),
        rollup: "pending",
        runs: [],
        statuses: [{ context: "ci/jenkins", state: "pending", description: "Build running", targetUrl: null }],
      }),
    });
    const rail = await openPrTab(page);
    const checks = rail.locator('section[aria-label="Checks"]');
    await expect(checks.getByRole("heading")).toContainText("0/1 passed · 1 running");
    await expect(checks.getByText("ci/jenkins", { exact: true })).toBeVisible();
    await expect(checks.getByText(/No check/)).toHaveCount(0);
  });

  test("19c. the full PR view's gate follows the route's rollup past what the list shows", async ({ page }) => {
    await base(page);
    // Every listed run passed; a status past the first page failed.
    await githubMocks(page, {
      checks: () => ({ ok: true, authed: true, sha: SHA("a"), rollup: "failing", runs: [run("job 1")], statuses: [] }),
    });
    const rail = await openPrTab(page);
    await rail.getByRole("button", { name: "Full PR view" }).click();
    const card = page.getByTestId("github-pr-reader").locator('section[aria-label="Checks"]').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".pr-reader__gate").first()).toContainText("a check is failing");
    await expect(card.locator(".pr-reader__merge-reason")).toHaveText("Blocked by checks.");
  });

  test("20. threads that couldn't be read, or were cut off, say so with a link to GitHub", async ({ page }) => {
    await base(page);
    let comments: Record<string, unknown> = {
      ...threadsOk,
      authed: false,
      canResolve: false,
      reviewEvidenceComplete: false,
      reviewEvidenceError: "Review threads require GitHub authentication.",
    };
    await githubMocks(page, {
      checks: () => ({ ok: true, authed: false, sha: SHA("a"), rollup: "passing", runs: [run("ci")], statuses: [] }),
      comments: () => comments,
    });
    const rail = await openPrTab(page);
    const threads = rail.locator('section[aria-label="Review threads"]');
    await expect(threads).toContainText("Review threads require GitHub authentication.");
    await expect(threads.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute("href", "https://github.com/acme/alpha/pull/7");
    await expect(threads.getByText("No review threads.")).toHaveCount(0);
    await expect(threads.getByRole("heading")).not.toContainText("open");

    // A hundred resolved threads, and more past them.
    comments = {
      ...threadsOk,
      reviewThreads: Array.from({ length: 100 }, (_, i) => ({
        id: `t${i}`,
        isResolved: true,
        isOutdated: false,
        path: `f${i}.ts`,
        comments: [{ id: `c${i}`, author: { login: "rev" }, body: "nit", createdAt: null }],
      })),
      reviewEvidenceComplete: false,
      reviewEvidenceError: "Review thread evidence is incomplete; open GitHub for the remaining discussion.",
    };
    await rail.getByRole("tab", { name: /Changes/ }).click();
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await expect(threads).toContainText("Review thread evidence is incomplete");
    await expect(threads.getByText("All threads resolved.")).toHaveCount(0);
    await expect(threads.getByRole("heading")).not.toContainText("resolved");

    // The full PR view gives no total and no "No review threads" either.
    await rail.getByRole("button", { name: "Full PR view" }).click();
    const readerThreads = page.getByTestId("github-pr-reader").locator('section[aria-label="Review threads"]');
    await expect(readerThreads).toContainText("Review thread evidence is incomplete", { timeout: 30_000 });
    await expect(readerThreads.getByRole("button", { name: "Open on GitHub" })).toBeVisible();
    await expect(readerThreads.locator(".pr-reader__section-meta")).toHaveCount(0);
  });

  test("27. past four sessions, the least recently used session's desk shells are stopped, and start again on return", async ({ page }) => {
    const sessions = Array.from({ length: 6 }, (_, i) =>
      mkSession({
        id: `s${i + 1}`,
        title: `Session ${i + 1}`,
        status: "idle",
        project_root: "/repo/alpha",
        updated_at: new Date(Date.parse(NEW_ISO) - i * 60_000).toISOString(),
        familiarWorkspace: false,
        git: {
          branch: "main",
          repositoryUrl: "https://github.com/acme/alpha",
          worktreeRoot: `/repo/alpha/.worktrees/s${i + 1}`,
          isWorktree: true,
        },
      }),
    );
    await base(page, sessions);
    await openDesk(page);
    // A desktop shell's stop is a native command. Stand one in for the drawers
    // mounted from here on, recording each call, with a shell table behind it.
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const calls: { cmd: string; threadId: string | null }[] = [];
      const running = new Set<string>();
      let listener = 0;
      w.__ptyCalls = calls;
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback: () => ++listener,
        unregisterCallback() {},
        convertFileSrc: (path: string) => path,
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          const options = args?.options as Record<string, unknown> | undefined;
          const threadId = (args?.threadId as string | undefined) ?? (options?.thread_id as string | undefined) ?? null;
          calls.push({ cmd, threadId });
          if (cmd === "pty_diagnose") return { exit: 0, bytes: 18, output: "coven-cave-pty-ok" };
          if (cmd === "pty_list") return [...running];
          if (cmd === "pty_start" && threadId) running.add(threadId);
          if (cmd === "pty_stop" && threadId) running.delete(threadId);
          if (cmd === "pty_snapshot") return [];
          if (cmd === "plugin:event|listen") return ++listener;
          return null;
        },
      };
    });
    const calls = () =>
      page.evaluate(() => (window as unknown as { __ptyCalls: { cmd: string; threadId: string | null }[] }).__ptyCalls);
    const stops = async () => (await calls()).filter((call) => call.cmd === "pty_stop").map((call) => call.threadId);
    const panes = page.locator('[data-testid="code-terminal-workspace"] section[aria-label^="Terminal "]');

    const useTerminal = async (id: string) => {
      await page.locator(`[data-code-session-id='${id}']`).first().click();
      await expect(page.getByTestId("code-workbench")).toBeVisible();
      const toggle = page.getByRole("button", { name: "Open the terminal drawer" });
      if (await toggle.isVisible()) await toggle.click();
      await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toBeVisible();
      await expect.poll(async () => (await calls()).some((call) => call.cmd === "pty_start" && call.threadId === `cave.rail.${id}`)).toBe(true);
    };

    const starts = async (threadId: string) =>
      (await calls()).filter((call) => call.cmd === "pty_start" && call.threadId === threadId).length;

    await useTerminal("s1");
    await page.locator(".code-terminal-workspace__bar").getByRole("button", { name: "Split terminal right" }).click();
    await expect(panes).toHaveCount(2);
    await expect.poll(async () => (await calls()).filter((call) => call.cmd === "pty_start").length).toBe(2);
    const s1Split = (await calls()).find((call) => call.cmd === "pty_start" && call.threadId?.startsWith("cave.code.s1."))!.threadId;
    await useTerminal("s2");
    // s2's drawer is closed again: its shell keeps running until the cap stops it.
    await page.getByRole("button", { name: "Close the terminal drawer" }).click();
    for (const id of ["s3", "s4"]) await useTerminal(id);
    expect(await stops(), "four sessions keep their shells").toEqual([]);

    // A fifth session's drawer stops the oldest session's shells, split included.
    await useTerminal("s5");
    await expect.poll(stops).toEqual(expect.arrayContaining(["cave.rail.s1", s1Split]));
    expect(await stops()).toHaveLength(2);

    // Back on s1: one pane, a fresh shell, and now s2 is the oldest.
    const startsBefore = await starts("cave.rail.s1");
    await page.locator("[data-code-session-id='s1']").first().click();
    await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toBeVisible();
    await expect(panes).toHaveCount(1);
    await expect.poll(() => starts("cave.rail.s1")).toBe(startsBefore + 1);
    await expect.poll(stops).toContain("cave.rail.s2");
    expect(await stops()).not.toContain("cave.rail.s5");

    // Visiting s2 with its drawer closed starts no shell behind it.
    expect(await starts("cave.rail.s2")).toBe(1);
    await page.locator("[data-code-session-id='s2']").first().click();
    await expect(page.getByRole("button", { name: "Open the terminal drawer" })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await starts("cave.rail.s2"), "a stopped session's shell waits for its drawer").toBe(1);
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect.poll(() => starts("cave.rail.s2")).toBe(2);
  });
  test("27b. archiving a session stops its desk shells", async ({ page }) => {
    const list = { sessions: [NEWEST, OLDER] as unknown[] };
    await base(page, list.sessions);
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: list.sessions } }));
    await openDesk(page);
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const calls: { cmd: string; threadId: string | null }[] = [];
      let listener = 0;
      w.__ptyCalls = calls;
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback: () => ++listener,
        unregisterCallback() {},
        convertFileSrc: (path: string) => path,
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          const options = args?.options as Record<string, unknown> | undefined;
          calls.push({ cmd, threadId: (args?.threadId as string | undefined) ?? (options?.thread_id as string | undefined) ?? null });
          if (cmd === "pty_diagnose") return { exit: 0, bytes: 18, output: "coven-cave-pty-ok" };
          if (cmd === "pty_list" || cmd === "pty_snapshot") return [];
          if (cmd === "plugin:event|listen") return ++listener;
          return null;
        },
      };
    });
    const calls = () =>
      page.evaluate(() => (window as unknown as { __ptyCalls: { cmd: string; threadId: string | null }[] }).__ptyCalls);
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect.poll(async () => (await calls()).some((call) => call.cmd === "pty_start" && call.threadId === "cave.rail.s-new")).toBe(true);
    list.sessions = [{ ...(NEWEST as Record<string, unknown>), archived_at: NEW_ISO }, OLDER];
    await expect
      .poll(async () => (await calls()).some((call) => call.cmd === "pty_stop" && call.threadId === "cave.rail.s-new"), { timeout: 20_000 })
      .toBe(true);
    expect((await calls()).some((call) => call.cmd === "pty_stop" && call.threadId === "cave.rail.s-old"), "only the archived one").toBe(false);
  });
});
