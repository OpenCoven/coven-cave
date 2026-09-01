import { expect, test, type Locator, type Page } from "@playwright/test";

// The dedicated Code surface (cave-k0ua): a Codex-style multi-session coding
// workbench — session rail grouped by project, per-session workbench
// (Diff | Files | Terminal | PR), inspector column, and simplified top-level
// navigation (Review | Work | GitHub) with GitHub sub-filters.
// Default-on since phase 2 (cave-m6ys); since cave-cc5r it lives as the
// Coding familiar's Role Surface room (`?mode=code` aliases onto
// `surface:code`), so the mocked familiar carries the explicit
// familiarType "coding" that unlocks the room.
//
// Daemon-less — onboarding dismissed, every endpoint mocked via page.route.

const OLD_ISO = "2026-06-12T10:00:00.000Z";
const NEW_ISO = "2026-06-12T12:00:00.000Z";

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

// Newest session: worktree-attributed branch + PR + diffstat (the enriched
// shape /api/sessions/list emits after session-git-enrich).
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
    worktreeRoot: "/repo/alpha/.worktrees/feat-flux",
    isWorktree: true,
  },
  pullRequest: { repo: "acme/alpha", number: 7, url: "https://github.com/acme/alpha/pull/7", state: "open" },
  diff: { additions: 12, deletions: 3 },
});
const OLDER = mkSession({
  id: "s-old",
  title: "Fix login retry",
  project_root: "/repo/alpha",
  familiarWorkspace: false,
  git: {
    branch: "main",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: "/repo/alpha/.worktrees/fix-login-retry",
    isWorktree: true,
  },
});
const CLEAN = mkSession({
  id: "s-clean",
  title: "Tidy the docs",
  status: "idle",
  project_root: "/repo/alpha",
  familiarWorkspace: false,
  git: {
    branch: "docs/tidy",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: "/repo/alpha/.worktrees/docs-tidy",
    isWorktree: true,
  },
});
const ALL_LOCAL_ONLY = mkSession({
  id: "s-local",
  title: "Scratchpad session",
  status: "idle",
  project_root: "/repo/alpha",
  familiarWorkspace: true,
  git: {
    branch: "scratch/local",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: "/repo/alpha/.worktrees/scratch-local",
    isWorktree: true,
  },
});
const REVIEW_ROOT = mkSession({
  id: "s-review-root",
  title: "Review root checkout",
  status: "running",
  updated_at: "2026-06-12T13:00:00.000Z",
  project_root: "/repo/alpha",
  familiarWorkspace: false,
  workBranch: "feat/review-root",
  git: {
    branch: "feat/review-root",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: "/repo/alpha",
    repositoryRoot: null,
    isWorktree: false,
  },
  pullRequest: { repo: "acme/alpha", number: 42, url: "https://github.com/acme/alpha/pull/42", state: "open" },
  diff: { additions: 9, deletions: 2 },
});
const REVIEW_LINKED = mkSession({
  id: "s-review-linked",
  title: "Linked worktree review",
  status: "idle",
  updated_at: "2026-06-12T12:20:00.000Z",
  project_root: "/repo/alpha/.worktrees/review-linked",
  familiarWorkspace: false,
  git: {
    branch: "feat/review-linked",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: "/repo/alpha/.worktrees/review-linked",
    repositoryRoot: "/repo/alpha",
    isWorktree: true,
  },
});
const FAMILIAR_WORKSPACE = mkSession({
  id: "s-familiar",
  title: "Familiar workspace scratch",
  status: "idle",
  updated_at: "2026-06-12T12:10:00.000Z",
  project_root: "/Users/dev/.coven/workspaces/familiars/nova/project",
  familiarWorkspace: true,
  git: {
    branch: "feat/familiar-scratch",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: "/Users/dev/.coven/workspaces/familiars/nova/project",
    repositoryRoot: null,
    isWorktree: false,
  },
});
const NON_GITHUB = mkSession({
  id: "s-non-github",
  title: "Private forge session",
  status: "running",
  updated_at: "2026-06-12T12:40:00.000Z",
  project_root: "/Users/dev/code/private-forge",
  familiarWorkspace: false,
  git: {
    branch: "feat/private-forge",
    repositoryUrl: null,
    worktreeRoot: "/Users/dev/code/private-forge",
    repositoryRoot: null,
    isWorktree: false,
  },
});
const ROOTLESS = mkSession({
  id: "s-rootless",
  title: "Rootless handoff",
  status: "idle",
  updated_at: "2026-06-12T12:00:00.000Z",
  project_root: "",
  familiarWorkspace: false,
  git: null,
});
const UNCLASSIFIED = mkSession({
  id: "s-unclassified",
  title: "Unclassified workspace session",
  status: "idle",
  updated_at: "2026-06-12T12:30:00.000Z",
  project_root: "/Users/dev/code/unclassified",
  git: {
    branch: "feat/unclassified",
    repositoryUrl: "https://github.com/acme/unclassified",
    worktreeRoot: "/Users/dev/code/unclassified",
    repositoryRoot: null,
    isWorktree: false,
  },
  diff: { additions: 1, deletions: 1 },
});
const ARCHIVED_LOCAL = mkSession({
  id: "s-archived",
  title: "Archived importer",
  status: "idle",
  updated_at: "2026-06-12T11:50:00.000Z",
  archived_at: "2026-06-12T13:05:00.000Z",
  project_root: "/Users/dev/code/archived",
  familiarWorkspace: false,
  git: {
    branch: "feat/archived",
    repositoryUrl: "https://github.com/acme/archived",
    worktreeRoot: "/Users/dev/code/archived",
    repositoryRoot: null,
    isWorktree: false,
  },
});
const GENERATED_LOCAL = mkSession({
  id: "s-generated",
  title: "Generated planner run",
  status: "idle",
  updated_at: "2026-06-12T11:45:00.000Z",
  generated: true,
  project_root: "/Users/dev/code/generated",
  familiarWorkspace: false,
  git: {
    branch: "feat/generated",
    repositoryUrl: "https://github.com/acme/generated",
    worktreeRoot: "/Users/dev/code/generated",
    repositoryRoot: null,
    isWorktree: false,
  },
});

const REVIEW_FIRST_MATRIX = [
  REVIEW_ROOT,
  REVIEW_LINKED,
  FAMILIAR_WORKSPACE,
  NON_GITHUB,
  ROOTLESS,
  UNCLASSIFIED,
  ARCHIVED_LOCAL,
  GENERATED_LOCAL,
];
const REVIEW_FIRST_REVIEWABLE_IDS = ["s-review-root", "s-review-linked"];
const REVIEW_FIRST_ALL_LOCAL_IDS = [
  "s-review-root",
  "s-non-github",
  "s-unclassified",
  "s-review-linked",
  "s-familiar",
  "s-rootless",
];
const REVIEW_FIRST_EXCLUDED_ONLY = [
  FAMILIAR_WORKSPACE,
  NON_GITHUB,
  ROOTLESS,
  UNCLASSIFIED,
  ARCHIVED_LOCAL,
  GENERATED_LOCAL,
];
const REVIEW_FIRST_EXCLUDED_ONLY_IDS = [
  "s-non-github",
  "s-unclassified",
  "s-familiar",
  "s-rootless",
];

async function activeCodeSessionId(page: Page) {
  return page.evaluate(
    () => document.activeElement?.getAttribute("data-code-session-id") ?? null,
  );
}

async function visibleCodeSessionIds(scope: Locator) {
  return scope.locator("[data-code-session-id]").evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute("data-code-session-id"))
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

async function base(
  page: Page,
  sessions: unknown[] = [NEWEST, OLDER],
  familiarType = "coding",
) {
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
          familiarType,
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }),
  );
  await page.route("**/api/daemon/status**", (route) =>
    route.fulfill({
      json: {
        running: true,
        availability: "online",
        target: { mode: "local" },
      },
    }),
  );
  await page.route("**/api/daemon/connection**", (route) =>
    route.fulfill({
      json: {
        running: true,
        availability: "online",
        checkedAt: new Date().toISOString(),
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
  await page.route("**/api/onboarding/install**", (route) =>
    route.fulfill({ json: { npmBusy: false } }),
  );
  await page.route("**/api/cave-home-migration**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        status: {
          pending: [],
          conflicts: [],
          migrated: true,
          details: [],
          backupRoot: "",
          journalPath: "",
        },
      },
    }),
  );
  await page.route("**/api/roles**", (route) => route.fulfill({ json: { ok: true, roles: [] } }));
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions } }),
  );
  // One handler, two contracts: ?branches=1 (inspector) vs status (Diff tab).
  await page.route("**/api/changes**", (route) => {
    const url = route.request().url();
    if (url.includes("branches=1")) {
      route.fulfill({
        json: {
          ok: true,
          branches: [
            { name: "main", current: false, worktree: null },
            { name: "feat/flux", current: true, worktree: "feat-flux", worktreePath: "/repo/alpha/.worktrees/feat-flux" },
          ],
        },
      });
      return;
    }
    route.fulfill({
      json: {
        ok: true,
        repo: true,
        repoRoot: "/repo/alpha",
        files: [{ path: "src/flux.ts", status: "modified" }],
      },
    });
  });
  await page.route("**/api/project-tree**", (route) =>
    route.fulfill({ json: { ok: true, entries: [{ name: "README.md", path: "/repo/alpha/README.md", isDir: false }] } }),
  );
  await page.route("**/api/project-file**", (route) =>
    route.fulfill({ json: { ok: true, kind: "text", content: "# Alpha\n\nHello.", size: 16 } }),
  );
}

async function mockGitHubActivity(page: Page) {
  const complete = {
    status: "complete",
    shown: 0,
    total: 0,
    hasMore: false,
    incomplete: false,
    githubIncomplete: false,
  };
  await page.route("**/api/github/pat**", (route) =>
    route.fulfill({ json: { hasPat: true, login: "val" } }),
  );
  await page.route("**/api/github/activity**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        authed: true,
        login: "val",
        organizations: ["OpenCoven"],
        collections: {
          authored: complete,
          reviewRequests: complete,
          assignedIssues: complete,
        },
        items: [{
          kind: "notification",
          id: "notification:release-alert",
          title: "Release alert",
          repo: "OpenCoven/coven-cave",
          url: "https://github.com/OpenCoven/coven-cave/releases",
          updatedAt: NEW_ISO,
        }],
        rateLimit: { remaining: 100, limit: 5000 },
      },
    }),
  );
  await page.route("**/api/board**", (route) =>
    route.fulfill({ json: { ok: true, cards: [] } }),
  );
}

async function mockWorkScheduler(page: Page) {
  await page.route("**/api/queue/readiness", (route) =>
    route.fulfill({
      json: {
        readiness: {
          ok: true,
          message: "",
          project: { id: "e2e-project", name: "E2E Project", root: "/repo/alpha" },
        },
      },
    }),
  );
  await page.route("**/api/beads?mode=ready**", (route) =>
    route.fulfill({ json: { ok: true, data: [] } }),
  );
  await page.route("**/api/beads?mode=blocked**", (route) =>
    route.fulfill({ json: { ok: true, data: [], blockers: [] } }),
  );
}

test.describe.configure({ mode: "serial" });

test.describe("code surface (Coding familiar's room)", () => {
  test("review-first queue defaults to Reviewable, keeps rail/picker order aligned, and resets on reload", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page, REVIEW_FIRST_MATRIX);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    const rail = page.getByRole("complementary", { name: "Coding sessions" });
    const scope = rail.getByRole("group", { name: "Session scope" });
    const reviewableButton = scope.getByRole("button", { name: /Reviewable/ });
    const allLocalButton = scope.getByRole("button", { name: /All local/ });
    const pickerTrigger = page.locator(".code-picker__trigger");

    await expect(rail).toBeVisible({ timeout: 30_000 });
    await expect(reviewableButton).toHaveAttribute("aria-pressed", "true");
    await expect(rail.getByText("acme/alpha", { exact: true })).toBeVisible();
    await expect(page.getByTestId("code-workbench-header").getByRole("button", { name: /Review root checkout/ })).toBeVisible();
    await expect(rail.locator('[data-code-session-id="s-review-linked"]')).toBeVisible();
    await expect.poll(() => visibleCodeSessionIds(rail)).toEqual(REVIEW_FIRST_REVIEWABLE_IDS);
    await expect(rail.locator('[data-code-session-id="s-familiar"]')).toHaveCount(0);
    await expect(rail.locator('[data-code-session-id="s-non-github"]')).toHaveCount(0);
    await expect(rail.locator('[data-code-session-id="s-rootless"]')).toHaveCount(0);
    await expect(rail.locator('[data-code-session-id="s-unclassified"]')).toHaveCount(0);

    await pickerTrigger.click();
    const picker = page.getByRole("dialog", { name: "Switch session" });
    await expect(picker).toBeVisible();
    await expect.poll(() => visibleCodeSessionIds(picker)).toEqual(REVIEW_FIRST_REVIEWABLE_IDS);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    await allLocalButton.click();
    await expect(allLocalButton).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => visibleCodeSessionIds(rail)).toEqual(REVIEW_FIRST_ALL_LOCAL_IDS);
    await expect(rail.locator('[data-code-session-id="s-archived"]')).toHaveCount(0);
    await expect(rail.locator('[data-code-session-id="s-generated"]')).toHaveCount(0);

    await pickerTrigger.click();
    await expect(picker.getByRole("group", { name: "Session scope" }).getByRole("button", { name: /All local/ })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => visibleCodeSessionIds(picker)).toEqual(REVIEW_FIRST_ALL_LOCAL_IDS);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    const reviewRow = rail.locator('[data-code-session-id="s-review-root"]');
    await reviewRow.focus();
    await expect.poll(() => activeCodeSessionId(page)).toBe("s-review-root");
    await page.keyboard.press("j");
    await expect.poll(() => activeCodeSessionId(page)).toBe("s-non-github");
    await page.keyboard.press("k");
    await expect.poll(() => activeCodeSessionId(page)).toBe("s-review-root");

    await reviewableButton.click();
    await expect(reviewableButton).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => visibleCodeSessionIds(rail)).toEqual(REVIEW_FIRST_REVIEWABLE_IDS);

    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    const reloadedRail = page.getByRole("complementary", { name: "Coding sessions" });
    const reloadedScope = reloadedRail.getByRole("group", { name: "Session scope" });
    await expect(reloadedRail).toBeVisible({ timeout: 30_000 });
    await expect(reloadedScope.getByRole("button", { name: /Reviewable/ })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => visibleCodeSessionIds(reloadedRail)).toEqual(REVIEW_FIRST_REVIEWABLE_IDS);
    await expect(reloadedRail.locator('[data-code-session-id="s-non-github"]')).toHaveCount(0);
  });

  test("a deep-linked excluded non-GitHub session stays open outside the current filter without leaking raw path details", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page, REVIEW_FIRST_MATRIX);
    await page.goto("/?mode=code&session=s-non-github", { waitUntil: "domcontentloaded" });

    const rail = page.getByRole("complementary", { name: "Coding sessions" });
    const scope = rail.getByRole("group", { name: "Session scope" });

    await expect(rail).toBeVisible({ timeout: 30_000 });
    await expect(scope.getByRole("button", { name: /Reviewable/ })).toHaveAttribute("aria-pressed", "true");
    await expect(rail.getByText("Outside current filter")).toBeVisible();
    await expect(page.getByTestId("code-workbench-header").getByRole("button", { name: /Private forge session/ })).toBeVisible();
    await expect(rail.locator("[data-code-session-id]")).toHaveCount(3);
    await expect(rail.locator('[data-code-session-id="s-review-root"]')).toBeVisible();
    await expect(rail.locator('[data-code-session-id="s-review-linked"]')).toBeVisible();
    await expect(rail.locator('[data-code-session-id="s-non-github"]')).toBeVisible();
    await expect(rail.locator('[data-code-session-id="s-familiar"]')).toHaveCount(0);
    await expect(rail.locator('[data-code-session-id="s-rootless"]')).toHaveCount(0);
    await expect(rail.locator('[data-code-session-id="s-unclassified"]')).toHaveCount(0);
    await expect(page.getByText("/Users/dev/code/private-forge")).toHaveCount(0);
    await expect(page.getByText("/Users/dev/.coven/workspaces/familiars/nova/project")).toHaveCount(0);
  });

  test("reviewable empty state uses the approved copy and All local remains the explicit escape hatch", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page, REVIEW_FIRST_EXCLUDED_ONLY);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    const rail = page.getByRole("complementary", { name: "Coding sessions" });
    const scope = rail.getByRole("group", { name: "Session scope" });

    await expect(rail).toBeVisible({ timeout: 30_000 });
    await expect(scope.getByRole("button", { name: /Reviewable/ })).toHaveAttribute("aria-pressed", "true");
    await expect(rail.getByText("No GitHub repository sessions need review.")).toBeVisible();
    await expect(rail.getByText("No reviewable sessions match this scope.")).toHaveCount(0);
    await expect(page.getByText("/Users/dev/code/private-forge")).toHaveCount(0);
    await expect(page.getByText("/Users/dev/code/unclassified")).toHaveCount(0);

    await scope.getByRole("button", { name: /All local/ }).click();
    await expect(scope.getByRole("button", { name: /All local/ })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => visibleCodeSessionIds(rail)).toEqual(REVIEW_FIRST_EXCLUDED_ONLY_IDS);
    await expect(rail.locator('[data-code-session-id="s-archived"]')).toHaveCount(0);
    await expect(rail.locator('[data-code-session-id="s-generated"]')).toHaveCount(0);
  });

  test("landing: rail groups sessions, newest auto-selected, attribution chips in the header", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    // Top tabs: Review is the default landing, with Work and one GitHub
    // primary destination replacing the previous equal-weight GitHub tabs.
    const topTabs = page.getByRole("tablist", { name: "Code surface" });
    await expect(topTabs).toBeVisible({ timeout: 30_000 });
    await expect(topTabs.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");
    await expect(topTabs.getByRole("tab", { name: "Work" })).toBeVisible();
    await expect(topTabs.getByRole("tab", { name: "GitHub" })).toBeVisible();
    await expect(topTabs.getByRole("tab", { name: "Sessions", exact: true })).toHaveCount(0);
    await expect(topTabs.getByRole("tab", { name: "Activity", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "GitHub filter" })).toHaveCount(0);

    // Rail: both sessions listed under their project group.
    const rail = page.getByRole("navigation", { name: "Coding sessions" });
    await expect(rail.getByText("Wire the flux capacitor")).toBeVisible();
    await expect(rail.getByText("Fix login retry")).toBeVisible();

    // Newest session auto-selected → its workbench header shows the
    // worktree-attributed branch (cave-9q24), PR badge, and diffstat.
    // Scoped to the header testid: the rail row and the nav's Recent
    // Activity roll-up legitimately repeat the same diffstat text.
    const header = page.getByTestId("code-workbench-header");
    await expect(header.getByRole("button", { name: /Wire the flux capacitor/ })).toBeVisible();
    await expect(header.getByText("feat/flux")).toBeVisible();
    await expect(header.getByText("#7")).toBeVisible();
    await expect(header.getByText("+12 −3")).toBeVisible();

    // cave-0rcku: review docks BESIDE the source as a rail whose default tab is
    // Changes — never a workbench tab you have to leave the file to reach.
    const reviewTabs = page.getByRole("tablist", { name: "Review surface" });
    await expect(reviewTabs.getByRole("tab", { name: /Changes/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tablist", { name: "Session workbench" })).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Session context" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "modified flux.ts src" })).toBeVisible({ timeout: 15_000 });

    // The shell is a permanent bottom drawer, not a tab — its bar is on screen
    // without anyone having gone looking for it.
    await expect(page.getByRole("button", { name: /Open the terminal drawer/ })).toBeVisible();
  });

  test("the tree marks changed files, the rail collapses to a spine, the inspector is a header popover", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("code-workbench-tree")).toBeVisible({ timeout: 30_000 });

    // cave-0rcku: the tree carries the working-tree status itself, so "what did
    // this session touch?" is answerable without leaving the file you are on.
    const tree = page.getByTestId("code-workbench-tree");
    const changedFilter = tree.getByRole("button", { name: /changed/ });
    await expect(changedFilter).toBeVisible();
    await changedFilter.click();
    await expect(changedFilter).toHaveAttribute("aria-pressed", "true");
    await expect(tree.getByRole("list", { name: "Changed files" })).toBeVisible();

    // The rail closes to a spine that STILL answers "is there anything to
    // review?" — a panel that vanished would make that unanswerable.
    const rail = page.getByTestId("code-review-rail");
    await expect(rail).toBeVisible();
    await page.getByRole("button", { name: "Hide the review rail" }).click();
    await expect(rail).toHaveCount(0);
    const spine = page.getByRole("button", { name: "Show the review rail" });
    await expect(spine).toBeVisible();
    await spine.click();
    await expect(page.getByTestId("code-review-rail")).toBeVisible();

    // Inspector: cave-0rcku moved it out of the retired dock and into a header
    // popover, so branches are one click from the file you are reading.
    await page.getByRole("button", { name: /Session inspector/ }).click();
    const inspector = page.getByRole("region", { name: "Branches" });
    await expect(inspector).toBeVisible({ timeout: 15_000 });
    await expect(inspector.getByText("main", { exact: true })).toBeVisible({ timeout: 15_000 });
    // The worktree mark on the branch row (the Root env row also contains
    // "feat-flux" inside the worktree path, so match the ⑂-prefixed form).
    await expect(inspector.getByText("⑂ feat-flux")).toBeVisible();
  });

  test("visible rail keyboard flow navigates rows and Enter opens the focused session", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page, [NEWEST, OLDER]);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    const rail = page.getByRole("navigation", { name: "Coding sessions" });
    await expect(rail).toBeVisible({ timeout: 30_000 });
    const selectedRow = rail.locator('button[data-code-session-id="s-new"]');
    const olderRow = rail.locator('button[data-code-session-id="s-old"]');
    await expect(selectedRow).toBeVisible();
    await expect(olderRow).toBeVisible();

    await expect(
      page.getByTestId("code-workbench-header").getByRole("button", { name: /Wire the flux capacitor/ }),
    ).toBeVisible();

    await selectedRow.focus();
    await expect
      .poll(() => activeCodeSessionId(page))
      .toBe("s-new");
    await page.keyboard.press("j");
    await expect
      .poll(() => activeCodeSessionId(page))
      .toBe("s-old");
    await expect(
      page.getByTestId("code-workbench-header").getByRole("button", { name: /Wire the flux capacitor/ }),
    ).toBeVisible();

    await page.keyboard.press("j");
    await expect
      .poll(() => activeCodeSessionId(page))
      .toBe("s-new");

    await page.keyboard.press("k");
    await expect
      .poll(() => activeCodeSessionId(page))
      .toBe("s-old");

    await page.keyboard.press("Enter");
    await expect(
      page.getByTestId("code-workbench-header").getByRole("button", { name: /Fix login retry/ }),
    ).toBeVisible();
  });

  test("slash opens picker search and keeps typing inside the picker query", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page, [NEWEST, OLDER, ALL_LOCAL_ONLY]);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    const trigger = page.locator(".code-picker__trigger");
    await expect(trigger).toBeVisible({ timeout: 30_000 });

    const scope = page
      .getByRole("navigation", { name: "Coding sessions" })
      .getByRole("group", { name: "Session scope" });
    await expect(scope.getByRole("button", { name: /Reviewable/ })).toHaveAttribute("aria-pressed", "true");
    await trigger.focus();
    await page.keyboard.press("Shift+A");
    await expect(scope.getByRole("button", { name: /All local/ })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("/");
    const search = page.locator("[data-code-session-search]");
    const picker = page.getByRole("dialog", { name: "Switch session" });
    const pickerScope = picker.getByRole("group", { name: "Session scope" });
    await expect(search).toBeFocused();
    await expect(picker.locator('[data-code-session-id="s-local"]')).toBeVisible();
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await page.keyboard.press("/");
    await expect(search).toHaveValue("jk/");
    await expect
      .poll(() => activeCodeSessionId(page))
      .toBe(null);

    await page.keyboard.press("Shift+A");
    await expect(pickerScope.getByRole("button", { name: /All local/ })).toHaveAttribute("aria-pressed", "true");
    await expect(search).toHaveValue("jk/A");
  });

  test("narrow landing slash opens the shared picker after Back to sessions", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only narrow viewport; mobile drill-in lives in tests/mobile/");
    await page.setViewportSize({ width: 760, height: 900 });
    await base(page, [NEWEST, OLDER, ALL_LOCAL_ONLY]);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    const rail = page.getByRole("navigation", { name: "Coding sessions" });
    const newest = rail.locator('button[data-code-session-id="s-new"]');
    await expect(rail).toBeVisible({ timeout: 30_000 });
    await newest.click();
    await expect(
      page.getByTestId("code-workbench-header").getByRole("button", { name: /Wire the flux capacitor/ }),
    ).toBeVisible();
    await expect(page.locator(".code-picker__trigger")).toHaveCount(1);

    await page.getByRole("button", { name: "Back to sessions" }).click();
    await expect(page.locator(".code-picker__trigger")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Search sessions" })).toBeVisible();

    const older = rail.locator('button[data-code-session-id="s-old"]');
    await older.focus();
    await page.keyboard.press("/");

    const picker = page.getByRole("dialog", { name: "Switch session" });
    const search = picker.locator("[data-code-session-search]");
    await expect(search).toHaveCount(1);
    await expect(search).toBeFocused();

    await page.keyboard.type("Fix");
    await expect(search).toHaveValue("Fix");
    await expect(picker.locator('[data-code-session-id="s-old"]')).toBeVisible();
    await expect(picker.locator('[data-code-session-id="s-new"]')).toHaveCount(0);
  });

  test("review rail and terminal panel state stays per-session with content-aware defaults", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page, [NEWEST, CLEAN]);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("code-review-rail")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Show the review rail" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toHaveCount(0);

    await page.getByRole("button", { name: "Hide the review rail" }).click();
    await expect(page.getByRole("button", { name: "Show the review rail" })).toBeVisible();
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByText("Terminal · this worktree")).toBeVisible();

    await page.locator(".code-picker__trigger").click();
    await page.getByRole("dialog", { name: "Switch session" }).locator('[data-code-session-id="s-clean"]').click();
    await expect(
      page.getByTestId("code-workbench-header").getByRole("button", { name: /Tidy the docs/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Show the review rail" })).toBeVisible();
    await expect(page.getByTestId("code-review-rail")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toHaveCount(0);

    await page.getByRole("button", { name: "Show the review rail" }).click();
    await expect(page.getByTestId("code-review-rail")).toBeVisible();
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByText("Terminal · this worktree")).toBeVisible();

    await page.locator(".code-picker__trigger").click();
    await page.getByRole("dialog", { name: "Switch session" }).locator('[data-code-session-id="s-new"]').click();
    await expect(
      page.getByTestId("code-workbench-header").getByRole("button", { name: /Wire the flux capacitor/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Show the review rail" })).toBeVisible();
    await expect(page.getByTestId("code-review-rail")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await page.locator(".code-picker__trigger").click();
    await page.getByRole("dialog", { name: "Switch session" }).locator('[data-code-session-id="s-clean"]').click();
    await expect(
      page.getByTestId("code-workbench-header").getByRole("button", { name: /Tidy the docs/ }),
    ).toBeVisible();
    await expect(page.getByTestId("code-review-rail")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("?mode=code&session=<id>&wtab=files deep link selects the session and tab", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await page.goto("/?mode=code&session=s-old&wtab=files", { waitUntil: "domcontentloaded" });

    // The deep-linked (NOT newest) session is selected…
    await expect(
      page.getByTestId("code-workbench-header").getByRole("button", { name: /Fix login retry/ }),
    ).toBeVisible({ timeout: 30_000 });
    // …with the file tree on screen (files are a column now, not a tab), and
    // the params stripped from the URL.
    await expect(page.getByTestId("code-workbench-tree")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .not.toContain("session=");
  });

  test("a narrow desktop ?wtab=files deep link drills into Files once layout is known", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only narrow viewport; mobile drill-in lives in tests/mobile/");
    await page.setViewportSize({ width: 760, height: 900 });
    await base(page);
    await page.goto("/?mode=code&session=s-old&wtab=files", { waitUntil: "domcontentloaded" });

    const header = page.getByTestId("code-workbench-header");
    await expect(header.getByRole("button", { name: /Fix login retry/ })).toBeVisible({ timeout: 30_000 });
    const steps = page.getByRole("tablist", { name: "Workbench step" });
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("code-workbench-tree")).toBeVisible();
    await expect(page.getByTestId("code-review-rail")).toHaveCount(0);
  });

  test("fixed queue shortcuts ignore conflicting saved workbench bindings", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await page.setViewportSize({ width: 1280, height: 900 });
    await base(page, [NEWEST, OLDER, ALL_LOCAL_ONLY]);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "cave.code.keymap",
        JSON.stringify({
          prompt: "/",
          files: "J",
          outline: "K",
          terminal: "Shift+A",
        }),
      );
    });
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    const trigger = page.locator(".code-picker__trigger");
    const terminalOpen = page.getByRole("button", { name: "Close the terminal drawer" });
    const tree = page.getByTestId("code-workbench-tree");
    const scope = page
      .getByRole("navigation", { name: "Coding sessions" })
      .getByRole("group", { name: "Session scope" });
    const selectedRow = page
      .getByRole("navigation", { name: "Coding sessions" })
      .locator('button[data-code-session-id="s-new"]');

    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await expect(terminalOpen).toHaveCount(0);
    await expect(scope.getByRole("button", { name: /Reviewable/ })).toHaveAttribute("aria-pressed", "true");

    await trigger.focus();
    await page.keyboard.press("Shift+A");
    await expect(scope.getByRole("button", { name: /All local/ })).toHaveAttribute("aria-pressed", "true");
    await expect(terminalOpen).toHaveCount(0);

    await page.keyboard.press("/");
    const picker = page.getByRole("dialog", { name: "Switch session" });
    const search = picker.locator("[data-code-session-search]");
    await expect(search).toBeFocused();

    await selectedRow.focus();
    await page.keyboard.press("j");
    await expect
      .poll(() => activeCodeSessionId(page))
      .toBe("s-old");
    await expect(tree).not.toBeFocused();

    await page.keyboard.press("k");
    await expect
      .poll(() => activeCodeSessionId(page))
      .toBe("s-new");
    await expect(tree).not.toBeFocused();
  });

  test("legacy GitHub mode lands on Activity and preserves notifications", async ({ page }) => {
    await base(page);
    await mockGitHubActivity(page);
    await page.goto("/?mode=github", { waitUntil: "domcontentloaded" });

    const topTabs = page.getByRole("tablist", { name: "Code surface" });
    // Wait for the tablist to MOUNT before asserting which tab is selected —
    // the same gate the Sessions test above uses. Without it the assertion runs
    // on Playwright's 5s default while the surface is still coming up, and
    // fails with "element(s) not found" rather than a wrong aria-selected. That
    // lost the race on roughly a third of CI runs, on main as well as on PR
    // branches, which is what made this the repo's most persistent e2e flake
    // (cave-u5fh7). Every other assertion for this surface in this file already
    // carries the 30s budget.
    await expect(topTabs).toBeVisible({ timeout: 30_000 });
    await expect(topTabs.getByRole("tab", { name: "GitHub" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const githubFilter = page.getByRole("tablist", { name: "GitHub filter" });
    await expect(githubFilter).toBeVisible({ timeout: 30_000 });
    await expect(githubFilter.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("heading", { name: "Release alert" })).toBeVisible({ timeout: 30_000 });
  });

  for (const { ctab, filter } of [
    { ctab: "prs", filter: "PRs" },
    { ctab: "issues", filter: "Issues" },
    { ctab: "reviews", filter: "Reviews" },
  ] as const) {
    test(`GitHub deep link ctab=${ctab} keeps the GitHub primary tab active and selects ${filter}`, async ({
      page,
    }) => {
      await base(page);
      await mockGitHubActivity(page);
      await page.goto(`/?mode=code&ctab=${ctab}`, { waitUntil: "domcontentloaded" });

      const topTabs = page.getByRole("tablist", { name: "Code surface" });
      await expect(topTabs).toBeVisible({ timeout: 30_000 });
      await expect(topTabs.getByRole("tab", { name: "GitHub" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const githubFilter = page.getByRole("tablist", { name: "GitHub filter" });
      await expect(githubFilter).toBeVisible({ timeout: 30_000 });
      await expect(githubFilter.getByRole("tab", { name: filter })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  }

  test("GitHub preserves the last selected PRs, Issues, or Reviews filter after visiting Review or Work", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await mockGitHubActivity(page);
    await mockWorkScheduler(page);
    await page.goto("/?mode=code&ctab=prs", { waitUntil: "domcontentloaded" });

    const topTabs = page.getByRole("tablist", { name: "Code surface" });
    const githubFilter = page.getByRole("tablist", { name: "GitHub filter" });
    await expect(topTabs).toBeVisible({ timeout: 30_000 });
    await expect(githubFilter).toBeVisible({ timeout: 30_000 });

    for (const step of [
      { filter: "PRs", detour: "Work" },
      { filter: "Issues", detour: "Review" },
      { filter: "Reviews", detour: "Work" },
    ] as const) {
      await githubFilter.getByRole("tab", { name: step.filter }).click();
      await expect(githubFilter.getByRole("tab", { name: step.filter })).toHaveAttribute(
        "aria-selected",
        "true",
      );

      await topTabs.getByRole("tab", { name: step.detour }).click();
      await expect(topTabs.getByRole("tab", { name: step.detour })).toHaveAttribute(
        "aria-selected",
        "true",
      );

      await topTabs.getByRole("tab", { name: "GitHub" }).click();
      await expect(topTabs.getByRole("tab", { name: "GitHub" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(githubFilter.getByRole("tab", { name: step.filter })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
  });

  test("the GitHub filter tablist uses roving tabindex and arrow-key selection with wraparound", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await mockGitHubActivity(page);
    await page.goto("/?mode=code&ctab=prs", { waitUntil: "domcontentloaded" });

    const githubFilter = page.getByRole("tablist", { name: "GitHub filter" });
    const activityTab = githubFilter.getByRole("tab", { name: "Activity" });
    const prsTab = githubFilter.getByRole("tab", { name: "PRs" });
    const issuesTab = githubFilter.getByRole("tab", { name: "Issues" });
    const reviewsTab = githubFilter.getByRole("tab", { name: "Reviews" });

    await expect(githubFilter).toBeVisible({ timeout: 30_000 });
    await expect(prsTab).toHaveAttribute("aria-selected", "true");
    await expect(prsTab).toHaveAttribute("tabindex", "0");
    await expect(activityTab).toHaveAttribute("tabindex", "-1");
    const prsPanelId = await prsTab.getAttribute("aria-controls");
    if (!prsPanelId) throw new Error("PRs tab should control a GitHub tabpanel");
    const prsTabId = await prsTab.getAttribute("id");
    if (!prsTabId) throw new Error("PRs tab should expose a stable id");
    await expect(page.locator(`#${prsPanelId}`)).toHaveAttribute("role", "tabpanel");
    await expect(page.locator(`#${prsPanelId}`)).toHaveAttribute("aria-labelledby", prsTabId);

    await prsTab.focus();
    await expect(prsTab).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(issuesTab).toBeFocused();
    await expect(issuesTab).toHaveAttribute("aria-selected", "true");
    await expect(issuesTab).toHaveAttribute("tabindex", "0");
    await expect(prsTab).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowLeft");
    await expect(prsTab).toBeFocused();
    await expect(prsTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("End");
    await expect(reviewsTab).toBeFocused();
    await expect(reviewsTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowRight");
    await expect(activityTab).toBeFocused();
    await expect(activityTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Home");
    await expect(activityTab).toBeFocused();
    await expect(activityTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowLeft");
    await expect(reviewsTab).toBeFocused();
    await expect(reviewsTab).toHaveAttribute("aria-selected", "true");
    await expect(reviewsTab).toHaveAttribute("tabindex", "0");
    await expect(activityTab).toHaveAttribute("tabindex", "-1");
  });

  test("a non-coding familiar sees the closed Coding Desk door", async ({ page }) => {
    await base(page, [NEWEST, OLDER], "general");
    await page.goto("/?mode=github", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByText("Nova doesn't hold the coder role, so this room stays closed."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Back to the Cave" })).toBeVisible();
  });

  test("organization settings move focus inside, retain it when selection disappears, and fit narrow panes", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "desktop project supplies the narrow viewport explicitly");
    await base(page);
    let releaseMemberships = () => {};
    const membershipsReady = new Promise<void>((resolve) => {
      releaseMemberships = resolve;
    });
    await page.route("**/api/github/activity**", async (route) => {
      await membershipsReady;
      await route.fulfill({
        json: {
          ok: true,
          authed: true,
          login: "val",
          organizations: ["OpenCoven"],
          items: [],
        },
      });
    });
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    const sessionsTab = page
      .getByRole("tablist", { name: "Code surface" })
      .getByRole("tab", { name: "Review" });
    // Establish keyboard modality before programmatically selecting the exact
    // tab under test so Chromium applies the :focus-visible inset ring.
    await page.keyboard.press("Tab");
    await sessionsTab.focus();
    await expect(sessionsTab).toBeFocused();
    // Report the real computed values rather than a collapsed boolean: a bare
    // `outlineMatchesToken: false` hides which half mismatched. The tab carries
    // `focus-ring-inset`, so the ring is drawn inside the box — width
    // `--ring-width` (2px) at the negated offset, not the outset `--ring-offset`.
    await expect
      .poll(
        () =>
          sessionsTab.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              focusVisible: element.matches(":focus-visible"),
              outlineWidth: style.outlineWidth,
              outlineOffset: style.outlineOffset,
            };
          }),
        { timeout: 30_000 },
      )
      .toEqual({ focusVisible: true, outlineWidth: "2px", outlineOffset: "-2px" });

    // Resize only after the desktop Code surface has mounted. Starting at a
    // phone width intentionally routes to the mobile workshop fallback.
    await page.setViewportSize({ width: 320, height: 700 });
    await page.getByRole("button", { name: "GitHub organization settings" }).click();
    const popover = page.getByRole("dialog", { name: "GitHub organization settings" });
    await expect(popover).toBeVisible({ timeout: 30_000 });
    const all = popover.getByRole("button", { name: "GitHub organization scope: All" });
    await expect(all).toBeFocused();

    const bounds = await popover.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(312);
    expect(
      await popover.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);

    const selected = popover.getByRole("button", { name: "GitHub organization scope: Selected" });
    await selected.click();
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(selected).toHaveAttribute("aria-pressed", "false");

    releaseMemberships();
    await expect(popover.getByText(/Every organization is included/)).toBeVisible();
    await selected.click();
    const checkbox = popover.getByRole("checkbox", { name: /OpenCoven/ });
    await expect(checkbox).toBeChecked();
    await checkbox.click();
    await expect(all).toBeFocused();
    await expect(popover).toBeVisible();
  });
});
