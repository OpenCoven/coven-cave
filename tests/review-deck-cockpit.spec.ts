import { expect, test, type Page } from "@playwright/test";

// Keep the production service worker from bypassing page.route fixtures.
test.use({ serviceWorkers: "block" });

// Review Deck cockpit (cave-8dj4q) — the three-column room where each column
// answers exactly one question: queue / diff / inspector.
//
// Daemon-less (COVEN_CAVE_E2E=1): every server truth is a page.route mock. The
// room only opens when the active familiar holds the reviewer role, so the
// mocked familiar's role label is "Reviewer" (familiarRoleIds tokenizes it).
//
// What is worth pinning here rather than in a source-text test: the things a
// green unit suite cannot see — that the three columns actually lay out side
// by side, that a rail collapse does not strand the diff, and that the
// inspector's decision sentence reflects the *mocked GitHub state* rather than
// whatever the component would render with no facts at all.

const FAMILIAR_ID = "reviewer";
const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const BLOCKED = "OpenCoven/coven-agents#3";
const READY = "OpenCoven/coven-cave#4788";

const SESSIONS = [
  {
    id: "s-blocked",
    project_root: "/tmp/coven-agents",
    harness: "claude",
    model: "opus-4.6",
    title: "Roster group chat protocol",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: iso(2900),
    updated_at: iso(2880),
    attention: "none",
    pullRequest: { repo: "OpenCoven/coven-agents", number: 3 },
    diff: { additions: 214, deletions: 38 },
    git: { branch: "feat/roster" },
  },
  {
    id: "s-ready",
    project_root: "/tmp/coven-cave",
    harness: "claude",
    model: "opus-4.6",
    title: "Session share links",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: iso(200),
    updated_at: iso(180),
    attention: "none",
    pullRequest: { repo: "OpenCoven/coven-cave", number: 4788 },
    diff: { additions: 410, deletions: 0 },
    git: { branch: "feat/share-links" },
  },
  {
    id: "s-local",
    project_root: "/tmp/coven",
    harness: "claude",
    model: "sonnet-4.5",
    title: "Ensure new projects have a subject line",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: iso(20),
    updated_at: iso(14),
    attention: "none",
    pullRequest: null,
    diff: { additions: 36, deletions: 1 },
    git: { branch: "main" },
  },
];

type PullFixture = {
  state: string;
  draft: boolean;
  merged: boolean;
  isPull: boolean;
  title?: string;
  pull: {
    headRef: string;
    baseRef: string;
    headSha: string;
    baseSha: string;
    commits: number;
    additions: number;
    deletions: number;
    changedFiles: number;
    mergeable: boolean;
    mergeableState: string;
    reviews: { approved: number; changesRequested: number; commented: number };
  };
};

const PULLS: Record<string, PullFixture> = {
  [BLOCKED]: {
    title: "Roster group chat protocol",
    state: "open",
    draft: false,
    merged: false,
    isPull: true,
    pull: {
      headRef: "feat/roster",
      baseRef: "main",
      headSha: "8f21c0412ab".padEnd(40, "0"),
      baseSha: "b".repeat(40),
      commits: 6,
      additions: 214,
      deletions: 38,
      changedFiles: 2,
      mergeable: false,
      mergeableState: "dirty",
      reviews: { approved: 0, changesRequested: 0, commented: 0 },
    },
  },
  [READY]: {
    title: "Session share links",
    state: "open",
    draft: false,
    merged: false,
    isPull: true,
    pull: {
      headRef: "feat/share-links",
      baseRef: "main",
      headSha: "4c19aa2ff30".padEnd(40, "0"),
      baseSha: "b".repeat(40),
      commits: 6,
      additions: 410,
      deletions: 0,
      changedFiles: 1,
      mergeable: true,
      mergeableState: "clean",
      reviews: { approved: 1, changesRequested: 0, commented: 0 },
    },
  },
};

const CHECKS: Record<string, unknown> = {
  [BLOCKED]: {
    runs: [
      { name: "ci/test (node 20)", status: "completed", conclusion: "failure", detailsUrl: "https://example.test/1" },
      { name: "typecheck", status: "completed", conclusion: "failure", detailsUrl: "https://example.test/2" },
    ],
  },
  [READY]: {
    runs: [{ name: "Frontend build", status: "completed", conclusion: "success", detailsUrl: null }],
  },
};

const COMMENTS: Record<string, unknown> = {
  [BLOCKED]: {
    canResolve: true,
    reviews: [],
    reviewThreads: [
      {
        id: "t1",
        isResolved: false,
        isOutdated: false,
        path: "src/api/roster-route.ts",
        line: 39,
        comments: [{ author: { login: "val" }, body: "Who authorizes roster writes?" }],
      },
    ],
  },
  [READY]: { canResolve: true, reviews: [{ author: { login: "rowan" }, state: "APPROVED", submittedAt: iso(60) }], reviewThreads: [] },
};

const PATCH = [
  "@@ -36,4 +36,8 @@ export async function POST(request: Request)",
  "   const body = await request.json();",
  "+  const actor = await resolveActor(request);",
  "+  if (!actor) return unauthorized();",
  "   return ok();",
].join("\n");

const DIFFS: Record<string, unknown> = {
  [BLOCKED]: {
    revision: { repo: "OpenCoven/coven-agents", number: 3, baseRef: "main", baseSha: "b".repeat(40), headSha: PULLS[BLOCKED].pull.headSha, mergeBaseSha: "c".repeat(40) },
    total: 2,
    files: [
      { filename: "src/api/roster-route.ts", status: "modified", additions: 24, deletions: 8, patch: PATCH },
      { filename: "src/roster/chat-roster.ts", status: "modified", additions: 96, deletions: 20, patch: PATCH },
    ],
  },
  [READY]: {
    revision: { repo: "OpenCoven/coven-cave", number: 4788, baseRef: "main", baseSha: "b".repeat(40), headSha: PULLS[READY].pull.headSha, mergeBaseSha: "c".repeat(40) },
    total: 1,
    files: [{ filename: "src/lib/share-tokens.ts", status: "added", additions: 49, deletions: 0, patch: PATCH }],
  },
};

function refOf(url: string): string {
  const params = new URL(url).searchParams;
  return `${params.get("repo")}#${params.get("number")}`;
}

type DeckFixture = {
  sessions?: typeof SESSIONS;
  pulls?: Record<string, PullFixture>;
  diffs?: typeof DIFFS;
  itemErrors?: Set<string>;
  incompleteEvidence?: Set<string>;
};

async function mockDeck(page: Page, fixture: DeckFixture = {}) {
  const mutations: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "reviewer");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          { id: FAMILIAR_ID, display_name: "Rune", role: "Reviewer", status: "active", icon: "ph:git-diff" },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: fixture.sessions ?? SESSIONS } }),
  );
  await page.route(/\/api\/inbox(\?|$)/, (route) =>
    route.fulfill({ json: { ok: true, items: [], unreadCount: 0 } }),
  );
  await page.route("**/api/inbox/stream**", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route(/\/api\/roles(\?|$)/, (route) => route.fulfill({ json: { roles: [] } }));
  await page.route(/\/api\/github\/item\?/, (route) => {
    const ref = refOf(route.request().url());
    return fixture.itemErrors?.has(ref)
      ? route.fulfill({ status: 503, json: { ok: false, error: "GitHub is temporarily unavailable" } })
      : route.fulfill({ json: { ok: true, ...((fixture.pulls ?? PULLS)[ref] ?? {}) } });
  });
  await page.route(/\/api\/github\/checks\?/, (route) => {
    const ref = refOf(route.request().url());
    return route.fulfill({
      json: {
        ok: true,
        sha: (fixture.pulls ?? PULLS)[ref]?.pull.headSha,
        statuses: [],
        ...((CHECKS[ref] as object) ?? { runs: [] }),
      },
    });
  });
  await page.route(/\/api\/github\/comments\?/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        reviewEvidenceComplete: !fixture.incompleteEvidence?.has(refOf(route.request().url())),
        reviewEvidenceError: fixture.incompleteEvidence?.has(refOf(route.request().url()))
          ? "GitHub review threads are unavailable." : null,
        ...((COMMENTS[refOf(route.request().url())] as object) ?? {
          canResolve: true,
          reviews: [],
          reviewThreads: [],
        }),
      },
    }),
  );
  await page.route(/\/api\/github\/diff\?/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        truncated: false,
        ...(((fixture.diffs ?? DIFFS)[refOf(route.request().url())] as object) ?? { total: 0, files: [] }),
      },
    }),
  );
  await page.route(/\/api\/changes\?/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        repo: true,
        repoRoot: "/tmp/coven",
        branch: "main",
        worktree: null,
        files: [{ path: "src/components/chat-view.tsx", status: "modified", insertions: 27, deletions: 1 }],
      },
    }),
  );
  await page.route(/\/api\/github\/(review|merge)(\?|$)/, (route) => {
    mutations.push(route.request().url());
    return route.fulfill({ status: 409, json: { ok: false, error: "Unexpected test mutation" } });
  });
  return { mutations };
}

/**
 * Enter by URL, not by event.
 *
 * `?mode=<page id>` is applied once on mount from `readModeParam()`, and a role
 * surface is a valid page id — so entry is deterministic. Dispatching
 * `cave:navigate-mode` instead races the shell's own mode restore: the deck
 * mounted, the restore ran, and the surface was replaced by Home mid-test.
 *
 * The room is still code-split, so the first entry pays a cold `next dev`
 * compile of its chunk. CI absorbs that once in the `warmup` project; a local
 * `--no-deps` run pays it here, hence the budget.
 */
async function openReviewDeck(page: Page, fixture: DeckFixture = {}, expectedRows = SESSIONS.length) {
  const handles = await mockDeck(page, fixture);
  await page.goto("/?mode=surface:reviewer-review-deck");
  await expect(page.locator(".rd-stage")).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".rd-row")).toHaveCount(expectedRows, { timeout: 60_000 });
  return handles;
}

test.describe("Review Deck cockpit", () => {
  test.describe.configure({ timeout: 180_000 });

  test("displayed revision A holds verdicts against metadata B and refresh binds the request", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    const headSha = "d".repeat(40);
    const pulls = { ...PULLS, [READY]: { ...PULLS[READY], pull: { ...PULLS[READY].pull, headSha } } };
    const handles = await openReviewDeck(page, { pulls });
    await page.locator(".rd-row", { hasText: "Session share links" }).click();
    await expect(page.locator(".rd-diff-card")).toContainText("resolveActor");
    await expect(page.getByText("The displayed diff and GitHub state refer to different revisions. Refresh and review the current diff before submitting.")).toBeVisible();
    await expect(page.locator(".rd-verdict-primary")).toBeDisabled();
    expect(handles.mutations).toEqual([]);

    const revision = { repo: "OpenCoven/coven-cave", number: 4788, baseRef: "main", baseSha: "b".repeat(40), headSha, mergeBaseSha: "c".repeat(40) };
    await page.route(/\/api\/github\/diff\?/, (route) => route.fulfill({
      json: { ok: true, revision, total: 1, files: [{ filename: "new.ts", patch: "@@ -0,0 +1 @@\n+revisionB" }] },
    }));
    await page.getByRole("button", { name: "Refresh review queue" }).click();
    await expect(page.locator(".rd-diff-card")).toContainText("revisionB");
    await expect(page.locator(".rd-verdict-primary")).toBeEnabled();
    await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
    await expect(page.locator(".rd-toast")).toHaveText("Reviewed new.ts. Every readable file on head ddddddd is reviewed.");
    await page.locator(".rd-verdict-primary").click();
    const request = page.waitForRequest((request) => request.url().includes("/api/github/merge") && request.method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: /Squash.*merge/i }).click();
    expect((await request).postDataJSON()).toMatchObject({ headSha, reviewedRevision: revision });
  });

  test("local review completion names the working tree rather than a fabricated head", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await openReviewDeck(page);
    await page.locator(".rd-row", { hasText: "Ensure new projects have a subject line" }).click();
    await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
    await expect(page.locator(".rd-toast")).toHaveText("Reviewed src/components/chat-view.tsx. Every readable file in this working tree is reviewed.");
    await expect(page.locator(".rd-verdict-primary")).toBeDisabled();
  });

  test("a pending shared-file diff cannot survive a switch to a different actionable PR", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    const handles = await openReviewDeck(page);
    let releaseA: (() => Promise<void>) | null = null;
    let releaseB: (() => Promise<void>) | null = null;
    await page.route(/\/api\/github\/diff\?/, (route) => new Promise<void>((resolve) => {
      const ref = refOf(route.request().url());
      const release = async () => {
        await route.fulfill({ json: {
          ok: true, ...(DIFFS[ref] as object), total: 1,
          files: [{ filename: "shared.ts", patch: `@@ -0,0 +1 @@\n+${ref === BLOCKED ? "PATCH_A" : "PATCH_B"}` }],
        } });
        resolve();
      };
      if (ref === BLOCKED) releaseA = release;
      else releaseB = release;
    }));
    await page.locator(".rd-row", { hasText: "Roster group chat protocol" }).click();
    await expect.poll(() => releaseA !== null).toBe(true);
    const switchSelection = page.locator(".rd-row", { hasText: "Session share links" }).click();
    await releaseA!();
    await switchSelection;
    await expect.poll(() => releaseB !== null).toBe(true);
    await expect(page.locator(".rd-verdict-primary")).toBeDisabled();
    await expect(page.locator(".rd-diff-card")).not.toContainText("PATCH_A");
    await releaseB!();
    await expect(page.locator(".rd-diff-card")).toContainText("PATCH_B");
    await expect(page.locator(".rd-diff-card")).not.toContainText("PATCH_A");
    await expect(page.locator(".rd-verdict-primary")).toBeEnabled();
    expect(handles.mutations).toEqual([]);
  });

  test("three columns lay out side by side, and each collapses without stranding the diff", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await openReviewDeck(page);

    const queue = page.locator(".rd-queue");
    const diff = page.locator(".rd-diff-card");
    const inspector = page.locator(".rd-inspector");
    await expect(queue).toBeVisible();
    await expect(diff).toBeVisible();
    await expect(inspector).toBeVisible();

    // Measure only what is mounted. `boundingBox()` on a detached element
    // waits for the full test timeout rather than returning null, so a helper
    // that measures all three panes hangs the moment one of them collapses.
    const box = async (locator: ReturnType<typeof page.locator>) => {
      const rect = await locator.boundingBox();
      if (!rect) throw new Error("expected a mounted, laid-out element");
      return rect;
    };
    const wide = {
      queue: await box(queue),
      diff: await box(diff),
      inspector: await box(inspector),
    };
    // Left to right, non-overlapping: the layout is a grid, not a stack.
    expect(wide.queue.x + wide.queue.width).toBeLessThanOrEqual(wide.diff.x + 1);
    expect(wide.diff.x + wide.diff.width).toBeLessThanOrEqual(wide.inspector.x + 1);
    // The body never scrolls sideways, whatever the rails are doing.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    // Collapsing the queue must give its width to the diff, not to nothing.
    await page.getByRole("button", { name: "Collapse review queue" }).click();
    await expect(queue).toBeHidden();
    expect((await box(diff)).width).toBeGreaterThan(wide.diff.width);

    await page.getByRole("button", { name: "Show review queue" }).click();
    await expect(queue).toBeVisible();

    await page.getByRole("button", { name: "Collapse the review inspector" }).click();
    await expect(inspector).toBeHidden();
    expect((await box(diff)).width).toBeGreaterThan(wide.diff.width);
  });

  test.describe("Review Desk clarity", () => {
    test("terminal PRs, duplicate links and 279 clean branches do not inflate actionable review", async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 980 });
      const pulls = {
        ...PULLS,
        [READY]: { ...PULLS[READY], title: "Share sessions with signed links" },
        "OpenCoven/coven-cave#5001": { ...PULLS[READY], state: "closed", merged: true },
        "OpenCoven/coven-cave#5002": { ...PULLS[READY], state: "closed" },
      };
      const sessions = [
        ...SESSIONS,
        { ...SESSIONS[1], id: "duplicate-ready", title: "A raw duplicate session prompt" },
        { ...SESSIONS[1], id: "merged", title: "Already merged", pullRequest: { repo: "OpenCoven/coven-cave", number: 5001 } },
        { ...SESSIONS[1], id: "closed", title: "Already closed", pullRequest: { repo: "OpenCoven/coven-cave", number: 5002 } },
        ...Array.from({ length: 279 }, (_, index) => ({
          ...SESSIONS[2], id: `branch-${index}`, title: `Clean branch ${index}`,
          git: { branch: `work/branch-${index}` }, diff: { additions: 0, deletions: 0 },
        })),
      ];
      const handles = await openReviewDeck(page, { sessions, pulls });
      await expect(page.locator(".rd-topbar").getByRole("button", { name: "All 3", exact: true })).toBeVisible();
      await expect(page.locator(".rd-row", { hasText: "Share sessions with signed links" })).toHaveCount(1);
      await expect(page.locator(".rd-row", { hasText: "Already" })).toHaveCount(0);
      await expect(page.locator(".rd-topbar").getByRole("button", { name: /Needs review 0/ })).toBeVisible();
      await expect(page.locator(".rd-row", { hasText: "Share sessions" }).locator(".rd-add")).toHaveText("+410");

      await page.getByRole("button", { name: "Branches", exact: true }).click();
      await expect(page.locator(".rd-row")).toHaveCount(279);
      await page.getByRole("searchbox", { name: "Search review items" }).fill("work/branch-278");
      await expect(page.locator(".rd-row")).toHaveCount(1);
      await expect(page.locator(".rd-row-title")).toHaveText("Clean branch 278");
      await page.getByRole("searchbox", { name: "Search review items" }).press("Escape");
      await expect(page.locator(".rd-row")).toHaveCount(279);
      expect(handles.mutations).toEqual([]);
    });

    test("refresh removes merged reviews, preserves notes and does not strand filtered selections", async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 980 });
      const pulls = structuredClone(PULLS);
      const handles = await openReviewDeck(page, { pulls });
      await page.locator(".rd-row", { hasText: "Session share links" }).click();
      await expect(page.locator(".rd-decision strong")).toHaveText("Ready to merge");
      await page.getByRole("textbox", { name: /Review note/ }).fill("Keep the signed-link expiry explicit.");
      await page.getByRole("searchbox", { name: "Search review items" }).fill("roster");
      await expect(page.locator(".rd-selection-notice")).toBeVisible();
      await expect(page.getByRole("textbox", { name: /Review note/ })).toHaveValue("Keep the signed-link expiry explicit.");
      await page.setViewportSize({ width: 640, height: 850 });
      await expect(page.locator(".rd-diff-card")).toBeVisible();
      await page.getByRole("button", { name: "Show in queue" }).click();
      await expect(page.locator(".rd-queue")).toBeVisible();
      await expect(page.getByRole("tab", { name: "Queue", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".rd-row")).toHaveCount(3);
      await page.setViewportSize({ width: 1600, height: 980 });

      pulls[READY].state = "closed";
      pulls[READY].merged = true;
      await page.getByRole("button", { name: "Refresh review queue" }).click();
      await expect(page.locator(".rd-row")).toHaveCount(2);
      await expect(page.locator(".rd-workbench-line h2")).not.toHaveText("Session share links");
      await expect(page.locator(".rd-verdict-primary")).not.toHaveText("Squash & merge");

      pulls[READY].state = "open";
      pulls[READY].merged = false;
      await expect(page.getByRole("button", { name: "Refresh review queue" })).toBeEnabled();
      await page.getByRole("button", { name: "Refresh review queue" }).click();
      await expect(page.locator(".rd-row")).toHaveCount(3);
      await page.locator(".rd-row", { hasText: "Session share links" }).click();
      await expect(page.getByRole("textbox", { name: /Review note/ })).toHaveValue("Keep the signed-link expiry explicit.");
      expect(handles.mutations).toEqual([]);
    });

    test("GitHub failures remain visible and non-authorizing, with a working retry", async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 980 });
      const itemErrors = new Set([BLOCKED]);
      const handles = await openReviewDeck(page, { itemErrors });
      await expect(page.locator(".rd-queue [role=alert]")).toBeVisible();
      await expect(page.locator(".rd-row", { hasText: "Roster group chat protocol" }).locator(".rd-add")).toHaveCount(0);
      await expect(page.locator(".rd-row", { hasText: "Roster group chat protocol" })).toContainText("Diff totals unavailable");
      await page.locator(".rd-row", { hasText: "Roster group chat protocol" }).click();
      await expect(page.locator(".rd-read-error")).toBeVisible();
      await expect(page.locator(".rd-verdict-primary")).toBeDisabled();
      await expect(page.locator(".rd-verdict-primary")).toHaveText("GitHub state unavailable");
      await page.getByRole("searchbox", { name: "Search review items" }).fill("unread-title-needle");
      await expect(page.locator(".rd-queue-empty strong")).toHaveText("No matches in loaded details");
      await expect(page.locator(".rd-queue")).toContainText("1 PR title is unread");
      await page.getByRole("searchbox", { name: "Search review items" }).fill("");
      itemErrors.clear();
      await page.getByRole("button", { name: "Retry GitHub read", exact: true }).click();
      await expect(page.locator(".rd-read-error")).toHaveCount(0);
      await expect(page.locator(".rd-queue [role=alert]")).toHaveCount(0);
      await expect(page.locator(".rd-decision strong")).toHaveText("Not safe to merge");
      expect(handles.mutations).toEqual([]);
    });

    test("an approved PR cannot merge when empty thread arrays represent missing evidence", async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 980 });
      const incompleteEvidence = new Set([READY]);
      const handles = await openReviewDeck(page, { incompleteEvidence });
      await page.locator(".rd-row", { hasText: "Session share links" }).click();
      await expect(page.locator(".rd-read-error")).toContainText("GitHub review threads are unavailable.");
      await expect(page.locator(".rd-verdict-primary")).toBeDisabled();
      incompleteEvidence.clear();
      await page.getByRole("button", { name: "Retry GitHub read", exact: true }).click();
      await expect(page.locator(".rd-decision strong")).toHaveText("Ready to merge");
      await expect(page.locator(".rd-verdict-primary")).toBeEnabled();
      expect(handles.mutations).toEqual([]);
    });

    test("compact typography, adaptive panes, file search and reading options work across themes", async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1600, height: 980 });
      const longLine = `+export const reviewDescription = "${"A long source line remains fully readable. ".repeat(12)}";`;
      const files = Array.from({ length: 16 }, (_, index) => ({
        filename: `src/features/conversations/${index === 0 ? "permissions" : `configuration-${index}`}/route.ts`,
        status: "modified", additions: 24, deletions: 8,
        patch: ["@@ -1,3 +1,4 @@", " export const enabled = true;", longLine, " export default enabled;"].join("\n"),
      }));
      await openReviewDeck(page, { diffs: { ...DIFFS, [BLOCKED]: { ...(DIFFS[BLOCKED] as object), total: files.length, files } } });
      await page.locator(".rd-row", { hasText: "Roster group chat protocol" }).click();
      await expect(page.getByRole("tab", { name: files[0].filename, exact: true })).toBeVisible();
      const typography = await page.locator(".rd-stage").evaluate((stage) => ({
        body: parseFloat(getComputedStyle(stage).fontSize),
        button: parseFloat(getComputedStyle(stage.querySelector(".rd-segment")!).fontSize),
        chip: parseFloat(getComputedStyle(stage.querySelector(".rd-file-chip")!).fontSize),
      }));
      expect(typography.button).toBeLessThan(typography.body);
      expect(typography.chip).toBeLessThan(typography.body);
      await page.screenshot({ path: testInfo.outputPath("review-desk-wide-dark.png"), animations: "disabled" });

      const queueGutter = page.getByRole("separator", { name: "Resize the queue" });
      const before = Number(await queueGutter.getAttribute("aria-valuenow"));
      await queueGutter.focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => Number(await queueGutter.getAttribute("aria-valuenow"))).toBeGreaterThan(before);

      await page.setViewportSize({ width: 1120, height: 900 });
      await expect(page.locator(".rd-queue")).toBeVisible();
      await expect(page.locator(".rd-inspector")).toHaveCount(0);
      await expect(page.locator(".rd-mobile-tabs")).toBeHidden();
      const queue = await page.locator(".rd-queue").boundingBox();
      const diff = await page.locator(".rd-diff-card").boundingBox();
      expect(queue && diff && queue.x + queue.width <= diff.x).toBeTruthy();
      expect(diff?.width).toBeGreaterThan(400);
      await page.getByRole("button", { name: "Show the review inspector" }).click();
      await expect(page.locator(".rd-queue")).toHaveCount(0);
      await expect(page.locator(".rd-diff-card")).toBeVisible();
      await page.getByRole("button", { name: "Collapse the review inspector" }).click();
      await expect(page.getByRole("button", { name: "Show the review inspector" })).toBeFocused();

      await page.getByRole("button", { name: "Browse changed files" }).click();
      const navigator = page.getByRole("dialog", { name: "All changed files" });
      await expect(navigator.getByRole("searchbox")).toBeFocused();
      await navigator.getByRole("searchbox").fill("configuration-15");
      const fileList = navigator.getByRole("listbox", { name: "Changed files" });
      await fileList.focus();
      await expect.poll(() => fileList.evaluate((list) => {
        const activeId = list.getAttribute("aria-activedescendant");
        return activeId !== null && list.contains(document.getElementById(activeId));
      })).toBe(true);
      await navigator.getByRole("searchbox").fill("no-matching-file");
      await expect(navigator.getByRole("option")).toHaveCount(0);
      expect(await fileList.getAttribute("aria-activedescendant")).toBeNull();
      await navigator.getByRole("searchbox").fill("configuration-15");
      await expect(navigator.getByRole("option")).toHaveCount(1);
      await fileList.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("tab", { name: files[15].filename })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("button", { name: "Browse changed files" })).toBeFocused();
      const refreshedDiff = page.waitForResponse((response) =>
        response.url().includes("/api/github/diff?") && refOf(response.url()) === BLOCKED,
      );
      await page.getByRole("button", { name: "Refresh review queue" }).click();
      await refreshedDiff;
      await expect(page.getByRole("tab", { name: files[15].filename })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("tab", { name: files[15].filename }).focus();
      await page.keyboard.press("Home");
      await expect(page.getByRole("tab", { name: files[0].filename })).toBeFocused();

      await page.getByRole("button", { name: "Diff reading options" }).click();
      await page.getByRole("checkbox", { name: "Wrap long lines" }).check();
      await page.getByRole("checkbox", { name: "Hide whitespace pairs" }).check();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Diff reading options" })).toBeFocused();
      await expect(page.locator(".rd-diff")).toHaveAttribute("data-wrap", "true");
      expect(await page.locator(".rd-diff").evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:review-deck:diff-preferences")!).wrapLines)).toBe(true);
      await page.evaluate(() => document.documentElement.setAttribute("data-mode", "light"));
      await page.screenshot({ path: testInfo.outputPath("review-desk-medium-light.png"), animations: "disabled" });
      expect(await page.locator(".rd-diff-card").evaluate((card) =>
        getComputedStyle(card).backgroundColor === getComputedStyle(card.querySelector(".rd-diff")!).backgroundColor,
      )).toBe(true);

      await page.setViewportSize({ width: 640, height: 850 });
      await expect(page.locator(".rd-mobile-tabs")).toBeVisible();
      await page.getByRole("tab", { name: "Queue", exact: true }).click();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Diff", exact: true })).toBeFocused();
      await expect(page.locator(".rd-diff-card")).toBeVisible();
      await page.getByRole("tab", { name: "Inspector", exact: true }).click();
      await page.getByRole("button", { name: "Collapse the review inspector" }).click();
      await expect(page.locator(".rd-diff-card")).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-theme", "tide");
        document.documentElement.setAttribute("data-mode", "dark");
      });
      await page.screenshot({ path: testInfo.outputPath("review-desk-narrow-tide.png"), animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  });

  test("the inspector's decision and blockers come from the mocked GitHub state", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await openReviewDeck(page);

    await page.locator(".rd-row", { hasText: "Roster group chat protocol" }).click();

    const decision = page.locator(".rd-decision");
    await expect(decision.locator("strong")).toHaveText("Not safe to merge", { timeout: 30_000 });
    // Two failing checks and a conflict are the author's; one thread is yours.
    await expect(decision.locator(".rd-decision-sub")).toContainText("needs you");

    const blockers = page.locator(".rd-blocker");
    await expect(blockers.filter({ hasText: "2 required checks are failing" })).toBeVisible();
    await expect(blockers.filter({ hasText: "Merge conflicts with main" })).toBeVisible();
    // Hardest stop first: BLOCKING outranks the thread's NEEDS YOU.
    await expect(page.locator(".rd-blocker-severity").first()).toHaveText("BLOCKING");
    // A failing check is never reported as the reviewer's to clear.
    await expect(
      blockers.filter({ hasText: "required checks are failing" }).locator(".rd-blocker-owner"),
    ).toHaveText("Author");

    // Merge stays unavailable and says why rather than disappearing.
    const merge = page.getByRole("button", { name: "Merge", exact: true });
    await expect(merge).toBeDisabled();
    await expect(merge).toHaveAttribute("title", /Blocked:/);
  });

  test("an approved, clean pull request offers merge; a local session offers no verdict", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await openReviewDeck(page);

    await page.locator(".rd-row", { hasText: "Session share links" }).click();
    await expect(page.locator(".rd-decision strong")).toHaveText("Ready to merge", { timeout: 30_000 });
    await expect(page.locator(".rd-verdict-primary")).toContainText("Squash & merge");

    await page.locator(".rd-row", { hasText: "subject line" }).click();
    await expect(page.locator(".rd-decision strong")).toHaveText("Local review only", {
      timeout: 30_000,
    });
    const primary = page.locator(".rd-verdict-primary");
    await expect(primary).toBeDisabled();
    await expect(primary).toContainText("Verdicts need a pull request");
  });

  test("a review thread renders at the diff line it was left on", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await openReviewDeck(page);

    await page.locator(".rd-row", { hasText: "Roster group chat protocol" }).click();
    await page.locator(".rd-file-chip", { hasText: "roster-route.ts" }).click();
    await expect(page.locator(".rd-diff-thread")).toContainText("Who authorizes roster writes?", {
      timeout: 30_000,
    });
  });

  test("narrowing hands the deck to one pane at a time without losing the diff", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await openReviewDeck(page);

    await page.setViewportSize({ width: 720, height: 900 });
    await expect(page.locator(".rd-mobile-tabs")).toBeVisible();
    // "files" is the default view, so the diff survives the narrowing.
    await expect(page.locator(".rd-diff-card")).toBeVisible();
    await expect(page.locator(".rd-queue")).toBeHidden();

    await page.getByRole("tab", { name: "Queue" }).click();
    await expect(page.locator(".rd-queue")).toBeVisible();
    await page.getByRole("tab", { name: "Inspector" }).click();
    await expect(page.locator(".rd-inspector")).toBeVisible();
  });
});
