import { expect, test, type Page } from "@playwright/test";

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

const PULLS: Record<string, unknown> = {
  [BLOCKED]: {
    state: "open",
    draft: false,
    merged: false,
    isPull: true,
    pull: {
      headRef: "feat/roster",
      baseRef: "main",
      headSha: "8f21c0412ab",
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
    state: "open",
    draft: false,
    merged: false,
    isPull: true,
    pull: {
      headRef: "feat/share-links",
      baseRef: "main",
      headSha: "4c19aa2ff30",
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
    total: 2,
    files: [
      { filename: "src/api/roster-route.ts", status: "modified", additions: 24, deletions: 8, patch: PATCH },
      { filename: "src/roster/chat-roster.ts", status: "modified", additions: 96, deletions: 20, patch: PATCH },
    ],
  },
  [READY]: {
    total: 1,
    files: [{ filename: "src/lib/share-tokens.ts", status: "added", additions: 49, deletions: 0, patch: PATCH }],
  },
};

function refOf(url: string): string {
  const params = new URL(url).searchParams;
  return `${params.get("repo")}#${params.get("number")}`;
}

async function mockDeck(page: Page) {
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
    route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  );
  await page.route(/\/api\/roles(\?|$)/, (route) => route.fulfill({ json: { roles: [] } }));
  await page.route(/\/api\/github\/item\?/, (route) =>
    route.fulfill({ json: { ok: true, ...((PULLS[refOf(route.request().url())] as object) ?? {}) } }),
  );
  await page.route(/\/api\/github\/checks\?/, (route) =>
    route.fulfill({ json: { ok: true, ...((CHECKS[refOf(route.request().url())] as object) ?? { runs: [] }) } }),
  );
  await page.route(/\/api\/github\/comments\?/, (route) =>
    route.fulfill({
      json: {
        ok: true,
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
        ...((DIFFS[refOf(route.request().url())] as object) ?? { total: 0, files: [] }),
      },
    }),
  );
  await page.route(/\/api\/changes\?/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        files: [{ path: "src/components/chat-view.tsx", status: "modified", additions: 27, deletions: 1 }],
      },
    }),
  );
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
async function openReviewDeck(page: Page) {
  await mockDeck(page);
  await page.goto("/?mode=surface:reviewer-review-deck");
  await expect(page.locator(".rd-stage")).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".rd-row")).toHaveCount(SESSIONS.length, { timeout: 60_000 });
}

test.describe("Review Deck cockpit", () => {
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

    await page.setViewportSize({ width: 820, height: 900 });
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
