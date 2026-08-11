import { expect, test, type Page } from "@playwright/test";

// The dedicated Code surface (cave-k0ua): a Codex-style multi-session coding
// workbench — session rail grouped by project, per-session workbench
// (Diff | Files | Terminal | PR), inspector column, and the GitHub content top
// tabs (Activity | PRs | Issues | Reviews).
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
  workBranch: "feat/flux",
  git: { branch: "feat/flux", worktreeRoot: "/repo/alpha/.worktrees/feat-flux", isWorktree: true },
  pullRequest: { repo: "acme/alpha", number: 7, url: "https://github.com/acme/alpha/pull/7", state: "open" },
  diff: { additions: 12, deletions: 3 },
});
const OLDER = mkSession({ id: "s-old", title: "Fix login retry", project_root: "/repo/alpha" });

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

test.describe.configure({ mode: "serial" });

test.describe("code surface (Coding familiar's room)", () => {
  test("landing: rail groups sessions, newest auto-selected, attribution chips in the header", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });

    // Top tabs: Sessions active, then the GitHub content tabs (PRs · Issues ·
    // Reviews) that replaced the single generic GitHub tab.
    const topTabs = page.getByRole("tablist", { name: "Code surface" });
    await expect(topTabs).toBeVisible({ timeout: 30_000 });
    await expect(topTabs.getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "true");
    await expect(topTabs.getByRole("tab", { name: "Activity" })).toBeVisible();
    await expect(topTabs.getByRole("tab", { name: "PRs" })).toBeVisible();
    await expect(topTabs.getByRole("tab", { name: "Issues" })).toBeVisible();
    await expect(topTabs.getByRole("tab", { name: "Reviews" })).toBeVisible();
    await expect(topTabs.getByRole("tab", { name: "GitHub", exact: true })).toHaveCount(0);

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

  test("legacy GitHub mode lands on Activity and preserves notifications", async ({ page }) => {
    await base(page);
    await mockGitHubActivity(page);
    await page.goto("/?mode=github", { waitUntil: "domcontentloaded" });

    const topTabs = page.getByRole("tablist", { name: "Code surface" });
    await expect(topTabs.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("heading", { name: "Release alert" })).toBeVisible({ timeout: 30_000 });
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
      .getByRole("tab", { name: "Sessions" });
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
