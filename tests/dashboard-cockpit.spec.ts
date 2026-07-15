import { expect, test, type Page } from "@playwright/test";

// Dashboard cockpit (cave-89b / cave-2it) — pins the interaction contracts of
// the /dashboard analytics surface: the sortable + filterable Familiar
// Insights table, the Space usage panel (sortable rows, cleanup links, honest
// truncation), and the Signals strip (dedupe-by-URL, stalest-first, capped
// with a drill-through overflow row).
//
// Daemon-less (COVEN_CAVE_E2E=1): every data source the cockpit polls is
// mocked via page.route, so the spec fully determines what renders. The
// /dashboard route itself is a standalone Next page (no daemon needed to
// serve it).

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
// activity ranking the sort assertions can key on.
const SESSIONS = [
  session("sage", 0), session("sage", 0), session("sage", 1), session("sage", 2), session("sage", 4),
  session("nova", 0), session("nova", 3),
  session("kitty", 1),
];

// The same PR from both GitHub endpoints with mismatched id shapes
// (activity prefixes "pr-", assigned is raw) — the exact cave-2it bug class —
// plus enough distinct stalled PRs to overflow the panel's cap of 8.
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

const SPACE_AREAS = [
  { id: "conversations", label: "Chat transcripts", relPath: "~/.coven/cave/conversations", exists: true, bytes: 9_000_000, files: 220, lastModifiedMs: NOW - 3_600_000, truncated: false },
  { id: "workspaces", label: "Familiar workspaces", relPath: "~/.coven/workspaces", exists: true, bytes: 1_400_000_000, files: 17_000, lastModifiedMs: NOW - 60_000, truncated: true },
  { id: "memory", label: "Familiar memory", relPath: "~/.coven/memory", exists: true, bytes: 7_000_000, files: 4, lastModifiedMs: NOW - 86_400_000, truncated: false },
  { id: "flows", label: "Flows", relPath: "~/.coven/flows", exists: true, bytes: 7_000, files: 2, lastModifiedMs: NOW - 2 * 86_400_000, truncated: false },
  { id: "journal", label: "Journal", relPath: "~/.coven/journal", exists: false, bytes: 0, files: 0, lastModifiedMs: null, truncated: false },
];

async function gotoDashboard(page: Page, inboxItems: unknown[] = []) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars", (route) => route.fulfill({ json: { ok: true, familiars: FAMILIARS } }));
  await page.route("**/api/familiars/*/contract", (route) => route.fulfill({ status: 404, json: {} }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: SESSIONS } }));
  await page.route("**/api/github/activity", (route) => route.fulfill({ json: { items: GH_ACTIVITY } }));
  await page.route("**/api/github/assigned", (route) => route.fulfill({ json: { items: GH_ASSIGNED } }));
  await page.route("**/api/space-usage", (route) => route.fulfill({ json: { ok: true, areas: SPACE_AREAS } }));
  await page.route("**/api/board", (route) => route.fulfill({ json: { cards: [] } }));
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { items: inboxItems } }));
  await page.route("**/api/coven-memory", (route) => route.fulfill({ json: { entries: [] } }));
  await page.route("**/api/retro-runs**", (route) => route.fulfill({ json: { snapshot: null } }));
  await page.goto("/dashboard");
  // The centerpiece table renders once familiars + sessions land.
  await expect(page.locator(".cockpit-fam__row").first()).toBeVisible({ timeout: 30_000 });
}

const rowNames = (page: Page) => page.locator(".cockpit-fam .cockpit-fam__name").allTextContents();

test("insights table sorts by column and filters by text", async ({ page }) => {
  await gotoDashboard(page);
  const table = page.locator(".cockpit-fam");

  // Sort by Activity (first click = desc): busiest familiar leads.
  await table.getByRole("button", { name: "Activity" }).click();
  expect((await rowNames(page))[0]).toBe("Sage");
  const activityHeader = table.locator('[role="columnheader"]', { has: page.getByRole("button", { name: "Activity" }) });
  await expect(activityHeader).toHaveAttribute("aria-sort", "descending");

  // Second click flips ascending: idle familiar leads.
  await table.getByRole("button", { name: "Activity" }).click();
  expect((await rowNames(page))[0]).toBe("Echo");
  await expect(activityHeader).toHaveAttribute("aria-sort", "ascending");

  // Name sort is alphabetical.
  await table.getByRole("button", { name: "Familiar" }).click();
  expect(await rowNames(page)).toEqual(["Echo", "Kitty", "Nova", "Sage"]);

  // The filter narrows by role and reports the match count.
  const filter = page.locator(".cockpit-fam__filter input");
  await filter.fill("scout");
  await expect(table.locator(".cockpit-fam__row")).toHaveCount(1);
  expect((await rowNames(page))[0]).toBe("Kitty");

  // A non-matching query shows the explicit empty message, not a blank table.
  await filter.fill("zzz");
  await expect(page.locator(".cockpit-fam__nomatch")).toContainText("No familiars match");
  await filter.fill("");
  await expect(table.locator(".cockpit-fam__row")).toHaveCount(FAMILIARS.length);
});

test("space usage panel sorts, shows honest truncation, and links cleanup paths", async ({ page }) => {
  await gotoDashboard(page);
  const space = page.locator(".cockpit-space");
  await expect(space).toBeVisible();

  // Missing areas are dropped; present ones render (4 of the 5 mocked).
  await expect(space.locator(".cockpit-space__row")).toHaveCount(4);

  // Default order is size-desc: the capped workspaces area leads, and its
  // figures carry the honest "+" lower-bound marker.
  const firstArea = space.locator(".cockpit-space__row .cockpit-space__area b").first();
  await expect(firstArea).toHaveText("Familiar workspaces");
  await expect(space.locator(".cockpit-space__row .cockpit-space__size b").first()).toContainText("+");

  // Sorting by Size flips to the smallest area.
  await space.getByRole("button", { name: "Size" }).click();
  await expect(firstArea).toHaveText("Flows");

  // Rows with an owning surface are cleanup links.
  const memoryRow = space.locator('a.cockpit-space__row:has-text("Familiar memory")');
  await expect(memoryRow).toHaveAttribute("href", "/?mode=agents");
});

test("signals dedupe same-URL PRs, lead with the stalest, and cap with an overflow row", async ({ page }) => {
  await gotoDashboard(page);
  const signals = page.locator(".cockpit-signals > li");
  await expect(signals.first()).toBeVisible();

  // 10 stalled PRs arrive duplicated across both endpoints (20 items).
  // Dedupe-by-URL → 10 signals → capped at 8 + 1 overflow row = 9 <li>.
  await expect(signals).toHaveCount(9);

  // Stalest first (PR 10 is 19 days stale).
  await expect(signals.first()).toContainText("Stalled PR 10");

  // The overflow row names the hidden count and drills into GitHub.
  const more = page.locator("a.cockpit-signal--more");
  await expect(more).toContainText("+2 more");
  await expect(more).toHaveAttribute("href", "/?mode=github");
});

// ── Needs you — live from the poll, honest when caught up (cave-456r) ────────
// The model used to be a first-paint server snapshot: fired items appearing
// after load never rendered, and clearing the last item husked the panel.
// These pin the client-built model path end-to-end.

test("caught up: the Needs you section stays, reading all clear", async ({ page }) => {
  await gotoDashboard(page); // inbox mocked empty
  const needs = page.locator('section[aria-label="Needs you"]');
  await expect(needs).toBeVisible();
  await expect(needs).toContainText("All clear — nothing needs you right now.");
  await expect(needs.locator(".dr-count")).toHaveCount(0);
});

test("a fired reminder from the poll renders in Needs you with a live count", async ({ page }) => {
  const nowIso = new Date(NOW).toISOString();
  await gotoDashboard(page, [{
    id: "r-fired", kind: "reminder", status: "fired", title: "Water the familiars",
    createdAt: nowIso, updatedAt: nowIso, firedAt: nowIso, recurrence: "none", source: "user",
  }]);
  const needs = page.locator('section[aria-label="Needs you"]');
  await expect(needs.locator(".dr-row__title")).toContainText("Water the familiars");
  await expect(needs.locator(".dr-count")).toHaveText("1");
  await expect(needs).not.toContainText("All clear");
});
