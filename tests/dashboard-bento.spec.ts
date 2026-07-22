import { expect, test, type Page } from "@playwright/test";

// Bento dashboard (cave-g9os) — pins the interaction contracts of the
// /dashboard surface imported from Claude Design: live stat tiles, the
// collapsible session heatmap, the three board buckets, the familiar roster
// (select → carousel jump), the activity-over-time carousel, the performance
// matrix, and the GitHub rail's dedupe-by-URL merge.
//
// Daemon-less (COVEN_CAVE_E2E=1): every data source the surface polls is
// mocked via page.route, so the spec fully determines what renders. The
// /dashboard route itself is a standalone Next page (no daemon needed).

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const FAMILIARS = [
  { id: "sage", display_name: "Sage", color: "#7c6cf0", emoji: "🦉", role: "Researcher", active_sessions: 1 },
  { id: "nova", display_name: "Nova", color: "#4db6ac", emoji: "✨", role: "Builder", active_sessions: 0 },
  { id: "kitty", display_name: "Kitty", color: "#e57373", emoji: "🐈", role: "Scout", active_sessions: 0 },
  { id: "echo", display_name: "Echo", color: "#ffb74d", emoji: "🪞", role: "Archivist", active_sessions: 0 },
];

let seq = 0;
const session = (familiarId: string, ageDays: number) => ({
  id: `s${++seq}`,
  familiarId,
  created_at: daysAgo(ageDays),
  updated_at: daysAgo(ageDays),
  archived_at: null,
  title: `session ${seq}`,
});
// Sage is busiest, Nova moderate, Kitty light, Echo idle → a deterministic
// carousel ranking (slide 1 = Sage) the assertions can key on.
const SESSIONS = [
  session("sage", 0), session("sage", 0), session("sage", 1), session("sage", 2), session("sage", 4),
  session("nova", 0), session("nova", 3),
  session("kitty", 1),
];

// The same PR from both GitHub endpoints with mismatched id shapes
// (activity prefixes "pr-", assigned is raw) — the exact cave-2it bug class.
// Dedupe must key on URL, so these 10 PRs stay 10, not 20.
const STALLED_PRS = Array.from({ length: 10 }, (_, i) => ({
  n: i + 1,
  title: `Stalled PR ${i + 1}`,
  url: `https://github.com/o/r/pull/${i + 1}`,
  updatedAt: daysAgo(10 + i),
}));
const GH_ACTIVITY = STALLED_PRS.map((p) => ({
  id: `pr-${p.n}`, kind: "pr", title: p.title, repo: "o/r", url: p.url, state: "open", updatedAt: p.updatedAt,
}));
const GH_ASSIGNED = STALLED_PRS.map((p) => ({
  id: String(p.n), kind: "pr", title: p.title, repo: "o/r", url: p.url, state: "open", updatedAt: p.updatedAt,
}));

const card = (id: string, title: string, status: string, familiarId: string | null, ageDays = 0) => ({
  id, title, status, familiarId,
  createdAt: daysAgo(ageDays + 1), updatedAt: daysAgo(ageDays),
  notes: "", priority: "medium", sessionId: null, cwd: null, links: [], github: [], asana: [],
  labels: [], lifecycle: "active", lifecycleAt: daysAgo(ageDays), retryCount: 0, maxRetries: 0, steps: [],
});

async function gotoDashboard(page: Page, opts: { inbox?: unknown[]; cards?: unknown[] } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars", (route) => route.fulfill({ json: { ok: true, familiars: FAMILIARS } }));
  await page.route("**/api/familiars/*/contract", (route) => route.fulfill({ status: 404, json: {} }));
  await page.route("**/api/familiars/*/self-reports**", (route) => route.fulfill({ json: { ok: true, reports: [], total: 0 } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: SESSIONS } }));
  await page.route("**/api/github/activity", (route) => route.fulfill({ json: { items: GH_ACTIVITY } }));
  await page.route("**/api/github/assigned", (route) => route.fulfill({ json: { items: GH_ASSIGNED } }));
  await page.route("**/api/board", (route) => route.fulfill({ json: { cards: opts.cards ?? [] } }));
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { items: opts.inbox ?? [] } }));
  await page.route("**/api/coven-memory", (route) => route.fulfill({ json: { entries: [] } }));
  await page.route("**/api/projects", (route) => route.fulfill({ json: { ok: true, projects: [{ id: "p1" }, { id: "p2" }] } }));
  await page.route("**/api/profile", (route) => route.fulfill({ json: { ok: true, profile: null } }));
  await page.goto("/dashboard");
  // The stat tiles render once sessions land; "8" is the mocked total.
  await expect(page.locator(".bd-stat-value").first()).toHaveText("8", { timeout: 30_000 });
}

test("stat tiles read live totals and the streak pips render", async ({ page }) => {
  await gotoDashboard(page);

  const stat = (label: string) =>
    page.locator(".bd-cell", { has: page.locator(".bd-label", { hasText: label }) }).locator(".bd-stat-value");
  await expect(stat("total sessions")).toHaveText("8");
  await expect(stat("familiars")).toHaveText("4");
  await expect(stat("projects")).toHaveText("2");

  // Streak tile: mocked sessions cover today+past days, so the streak is a
  // positive day count with at least one filled pip and a personal best.
  await expect(page.locator(".bd-streak-value")).toHaveText(/^[1-9]\d*d$/);
  await expect(page.locator(".bd-pip--filled").first()).toBeVisible();
  await expect(page.locator(".bd-pips-best")).toContainText(/best \d+d/);
});

test("heatmap is an aria-expanded collapsible with a full year of cells", async ({ page }) => {
  await gotoDashboard(page);

  const head = page.locator(".bd-heat-head");
  await expect(head).toHaveAttribute("aria-expanded", "true");
  // 53 week columns × 7 days.
  await expect(page.locator(".bd-heat-cell")).toHaveCount(53 * 7);
  // Cells carry human tooltips ("N sessions · <date>").
  await expect(page.locator(".bd-heat-cell[title*='session']").first()).toBeAttached();

  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".bd-heat-cell")).toHaveCount(0);

  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".bd-heat-cell")).toHaveCount(53 * 7);
});

test("board buckets: inbox + review cards need you, running in flight, done capped", async ({ page }) => {
  const nowIso = new Date(NOW).toISOString();
  await gotoDashboard(page, {
    inbox: [{
      id: "r-fired", kind: "reminder", status: "fired", title: "Water the familiars",
      createdAt: nowIso, updatedAt: nowIso, firedAt: nowIso, recurrence: "none", source: "user",
    }],
    cards: [
      card("c-rev", "Review the spec", "review", "sage"),
      card("c-run", "Build the thing", "running", "nova"),
      ...Array.from({ length: 5 }, (_, i) => card(`c-done-${i}`, `Shipped ${i + 1}`, "done", "kitty", i)),
    ],
  });

  const col = (title: RegExp) =>
    page.locator(".bd-board-col", { has: page.locator(".bd-board-col-title", { hasText: title }) });

  // Needs you = the fired reminder + the review card, and the count is live.
  const needs = col(/needs you \(2\)/);
  await expect(needs.locator(".bd-board-card-title")).toHaveText(["Water the familiars", "Review the spec"]);

  const inFlight = col(/in flight \(1\)/);
  await expect(inFlight.locator(".bd-board-card-title")).toHaveText(["Build the thing"]);

  // Done renders newest-first, capped at 4 of the 5 mocked.
  const done = col(/done \(4\)/);
  await expect(done.locator(".bd-board-card")).toHaveCount(4);
  await expect(done.locator(".bd-board-card-title").first()).toHaveText("Shipped 1");
});

test("empty board buckets state their emptiness instead of husking", async ({ page }) => {
  await gotoDashboard(page);
  await expect(page.locator(".bd-board-col", { hasText: "needs you (0)" }).locator(".bd-empty")).toHaveText("all clear");
  await expect(page.locator(".bd-board-col", { hasText: "in flight (0)" }).locator(".bd-empty")).toHaveText("nothing running");
  await expect(page.locator(".bd-board-col", { hasText: "done (0)" }).locator(".bd-empty")).toHaveText("no wins yet");
});

test("carousel leads with the coven aggregate and pages through top familiars", async ({ page }) => {
  await gotoDashboard(page);

  // Slide 0 aggregates all familiars; dots = 1 + top 4 = 5.
  await expect(page.locator(".bd-carousel-name")).toContainText("all familiars");
  const dots = page.locator(".bd-carousel-dots button");
  await expect(dots).toHaveCount(5);
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");

  // Next → the busiest familiar (Sage) with its weekly total.
  await page.getByRole("button", { name: "Next familiar chart" }).click();
  await expect(page.locator(".bd-carousel-name")).toContainText("Sage");
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".bd-spark-line")).toHaveCount(5);

  // Dots jump directly.
  await page.getByRole("button", { name: "Show Nova" }).click();
  await expect(page.locator(".bd-carousel-name")).toContainText("Nova");

  // Prev wraps from slide 0 to the last slide.
  await page.getByRole("button", { name: "Show all familiars" }).click();
  await page.getByRole("button", { name: "Previous familiar chart" }).click();
  await expect(dots.nth(4)).toHaveAttribute("aria-current", "true");
});

test("selecting a familiar in the roster toggles aria-pressed and jumps the carousel", async ({ page }) => {
  await gotoDashboard(page);

  const sage = page.locator(".bd-fam-item", { hasText: "Sage" });
  await expect(sage).toHaveAttribute("aria-pressed", "false");

  await sage.click();
  await expect(sage).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".bd-carousel-name")).toContainText("Sage");

  // Clicking again deselects; the carousel stays where the user left it.
  await sage.click();
  await expect(sage).toHaveAttribute("aria-pressed", "false");

  // The roster is also a collapsible.
  const toggle = page.locator(".bd-fam-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".bd-fam-item")).toHaveCount(0);
});

test("performance matrix renders a row per familiar and links to growth", async ({ page }) => {
  await gotoDashboard(page);

  const matrix = page.locator(".bd-matrix");
  await expect(matrix.locator(".bd-matrix-name")).toHaveText(["Sage", "Nova", "Kitty", "Echo"]);
  // No self-reports mocked → honest empty-state tooltips at level 0.
  await expect(matrix.locator(".bd-matrix-cell[title$='no reports yet']")).toHaveCount(16);
  await expect(matrix.locator("a[href='/dashboard/familiars/growth']")).toBeVisible();
});

test("github rail dedupes across endpoints by URL and rolls up per repo", async ({ page }) => {
  await gotoDashboard(page);

  const gh = page.locator(".bd-github");
  // One repo group, rows capped at 4 of the 10 PRs.
  await expect(gh.locator(".bd-github-repo")).toHaveText(["o/r"]);
  await expect(gh.locator(".bd-github-row")).toHaveCount(4);
  // 20 items arrived across the two endpoints; the footer proves dedupe → 10.
  await expect(gh.locator(".bd-github-foot")).toContainText("10 open items");
  await expect(gh.locator(".bd-github-foot")).toContainText("ci —");
});

test("activity feed merges sources with machine-readable times; footer ranks collaborators", async ({ page }) => {
  await gotoDashboard(page);

  const feed = page.locator(".bd-feed");
  await expect(feed.locator(".bd-feed-row").first()).toBeVisible();
  await expect(feed.locator("time.bd-feed-time").first()).toHaveAttribute("dateTime", /\d{4}-\d{2}-\d{2}T/);

  // All four familiars fit under the cap of 7; busiest first.
  const foot = page.locator(".bd-footer");
  await expect(foot.locator("a[href^='/dashboard/familiars/']")).toHaveCount(4);
  await expect(foot.locator("a[href^='/dashboard/familiars/']").first()).toHaveAttribute("href", "/dashboard/familiars/sage/profile");
  await expect(foot.locator(".bd-footer-stamp")).toContainText("COVEN CAVE");
});
