import { expect, test, type Page } from "@playwright/test";

// The dedicated Code surface (cave-k0ua): a Codex-style multi-session coding
// workbench — session rail grouped by project, per-session workbench
// (Diff | Files | Terminal | PR), inspector column, and the GitHub content top
// tabs (PRs | Issues | Reviews).
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

async function base(page: Page, sessions: unknown[] = [NEWEST, OLDER]) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", familiarType: "coding", status: "active", icon: "ph:sparkle-fill" }] } }),
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

test.describe("code surface (Coding familiar's room)", () => {
  test("landing: rail groups sessions, newest auto-selected, attribution chips in the header", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await page.goto("/?mode=code");

    // Top tabs: Sessions active, then the GitHub content tabs (PRs · Issues ·
    // Reviews) that replaced the single generic GitHub tab.
    const topTabs = page.getByRole("tablist", { name: "Code surface" });
    await expect(topTabs).toBeVisible({ timeout: 30_000 });
    await expect(topTabs.getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "true");
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
    await expect(header.getByRole("heading", { name: "Wire the flux capacitor" })).toBeVisible();
    await expect(header.getByText("feat/flux")).toBeVisible();
    await expect(header.getByText("#7 (open)")).toBeVisible();
    await expect(header.getByText("+12 −3")).toBeVisible();

    // Diff tab is the default and shows the mocked changed file (the row
    // renders basename + dir separately, so target the row button's name).
    const wb = page.getByRole("tablist", { name: "Session workbench" });
    await expect(wb.getByRole("tab", { name: "Diff" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "modified flux.ts src" })).toBeVisible({ timeout: 15_000 });
  });

  test("workbench tabs switch; Files shows tree + preview; inspector lists branches", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await page.goto("/?mode=code");

    const wb = page.getByRole("tablist", { name: "Session workbench" });
    await expect(wb).toBeVisible({ timeout: 30_000 });

    // Files: ProjectTree renders, picking a file loads the editable preview.
    await wb.getByRole("tab", { name: "Files" }).click();
    await expect(page.locator('[role="tree"]')).toBeVisible({ timeout: 15_000 });
    await page.getByText("README.md", { exact: false }).first().click();
    await expect(page.getByText("Hello.")).toBeVisible({ timeout: 15_000 });

    // Inspector: toggling the header control reveals branches with the
    // current-✓ / worktree-⑂ marks from the ?branches=1 contract.
    await page.getByRole("button", { name: "Toggle inspector" }).click();
    const inspector = page.getByRole("complementary", { name: "Session inspector" });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText("main", { exact: true })).toBeVisible({ timeout: 15_000 });
    // The worktree mark on the branch row (the Root env row also contains
    // "feat-flux" inside the worktree path, so match the ⑂-prefixed form).
    await expect(inspector.getByText("⑂ feat-flux")).toBeVisible();
  });

  test("?mode=code&session=<id>&wtab=files deep link selects the session and tab", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only (mobile drill-in covered in tests/mobile/)");
    await base(page);
    await page.goto("/?mode=code&session=s-old&wtab=files");

    // The deep-linked (NOT newest) session is selected…
    await expect(page.getByRole("heading", { name: "Fix login retry" })).toBeVisible({ timeout: 30_000 });
    // …with its Files tab active, and the params stripped from the URL.
    const wb = page.getByRole("tablist", { name: "Session workbench" });
    await expect(wb.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .not.toContain("session=");
  });
});
