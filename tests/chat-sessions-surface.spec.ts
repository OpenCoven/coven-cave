import { expect, test, type Page } from "@playwright/test";

/**
 * The Sessions list (cave-n3jg2, "Chat Session - Prototype.dc.html").
 *
 * The list's model has unit tests (chat-session-status / -activity / -sort) and
 * its wiring has source-text pins, but nothing asserted that the surface
 * behaves. These do. Behavioural only — cave-oqawv spent a night repairing five
 * stale source pins, not one of which had ever caught a real defect.
 */

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

type Seed = {
  id: string;
  title: string;
  status: string;
  ago: number;
  born: number;
  branch?: string;
  diff?: { additions: number; deletions: number };
};

/** Chosen so every band and every chip has a known population:
 *  running x1 (Active now), completed x2 (today + older), failed x1 (yesterday). */
const SEEDS: Seed[] = [
  { id: "s-run", title: "Prune the merged worktrees", status: "running", ago: 0, born: 40, branch: "main", diff: { additions: 53, deletions: 6 } },
  { id: "s-done-today", title: "Worktree and branch cleanup", status: "completed", ago: 45, born: 170, branch: "main", diff: { additions: 102, deletions: 0 } },
  { id: "s-fail", title: "Diagnose the failed CI workflow", status: "failed", ago: 1_500, born: 1_560, branch: "fix/ci" },
  { id: "s-done-old", title: "Optimize the image pipeline", status: "completed", ago: 13_000, born: 13_100, branch: "perf/images" },
];

const sessions = SEEDS.map((s) => ({
  id: s.id,
  project_root: "/repo",
  harness: "copilot",
  model: "github/gpt-5",
  title: s.title,
  status: s.status,
  exit_code: null,
  archived_at: null,
  created_at: iso(s.born),
  updated_at: iso(s.ago),
  familiarId: FAMILIAR.id,
  workBranch: s.branch ?? null,
  diff: s.diff ?? null,
  hasLocalConversation: true,
}));

const rows = (page: Page) => page.locator(".chat-session-card");
const chip = (page: Page, name: string) =>
  page.locator(".chat-status-chip").filter({ hasText: new RegExp(`^${name}`) }).first();
const bands = (page: Page) => page.locator(".chat-activity-header__label");

async function openSessionsList(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "nova");
  });
  await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [FAMILIAR] } }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions } }));
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
      return document.querySelector(".chat-surface") !== null;
    },
    undefined,
    { timeout: 30_000 },
  );
  // The surface lands on the new-chat launcher with Sessions already selected,
  // so clicking that tab fires no onChange. Bounce off Projects to make the
  // router hand back the list.
  const tab = (re: RegExp) => page.locator('.chat-scope-tabs [role="tab"]', { hasText: re }).first();
  await tab(/projects/i).click();
  await tab(/sessions/i).click();
  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("sessions list", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the list's card layout is desktop-only (min-width: 768px)");
    await openSessionsList(page);
  });

  test("status chips filter the list and count what the search found", async ({ page }) => {
    await expect(rows(page)).toHaveCount(SEEDS.length);

    // Each chip carries its own count, so "what failed?" is legible before you
    // press anything.
    await expect(chip(page, "All")).toContainText(String(SEEDS.length));
    await expect(chip(page, "Running")).toContainText("1");
    await expect(chip(page, "Completed")).toContainText("2");
    await expect(chip(page, "Failed")).toContainText("1");

    await chip(page, "Failed").click();
    await expect(chip(page, "Failed")).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Diagnose the failed CI workflow");

    // The counts are drawn from the SEARCHED set, not the filtered one — so
    // pressing one chip must not renumber the others. Without this the numbers
    // would collapse to "1 and zeroes" the moment you filtered.
    await expect(chip(page, "Completed")).toContainText("2");
    await expect(chip(page, "All")).toContainText(String(SEEDS.length));

    await chip(page, "All").click();
    await expect(rows(page)).toHaveCount(SEEDS.length);
  });

  test("running work floats into Active now regardless of when it started", async ({ page }) => {
    const labels = await bands(page).allTextContents();
    expect(labels.map((l) => l.trim().toLowerCase())).toContain("active now");

    // The running session is the first row: its band leads the list, which is
    // the whole point — live work is always in the same place.
    await expect(rows(page).first()).toContainText("Prune the merged worktrees");

    // Its own band header reports how many rows sit under it.
    const activeHeader = page.locator('.chat-activity-header[data-bucket="active"]');
    await expect(activeHeader).toBeVisible();
    await expect(activeHeader.locator(".chat-activity-header__count")).toHaveText("1");
  });

  test("a row reports its own branch, a labelled state, and how long it ran", async ({ page }) => {
    const running = rows(page).first();

    // The status is a LABEL, not just a tint — colour is never the only channel.
    await expect(running.locator(".chat-session-pill")).toContainText(/running/i);
    await expect(running.locator(".chat-session-pill")).toHaveAttribute("data-state", "running");

    // The session's OWN working branch, never the checkout's current one.
    await expect(running.locator(".chat-session-branch")).toContainText("main");

    // Elapsed time, and the working-tree delta the session produced.
    await expect(running.locator(".chat-session-stat").first()).toHaveText(/\d/);
    await expect(running.locator('.chat-session-stat[data-kind="adds"]')).toContainText("53");

    // A failed run wears a danger spine as well as its pill, so the state
    // survives a colour-blind read as a shape.
    const failed = rows(page).filter({ hasText: "Diagnose the failed CI workflow" }).first();
    await expect(failed).toHaveAttribute("data-status", "failed");
  });

  test("the list never presents an order it has not named", async ({ page }) => {
    // Default: recency, which is the order that earns activity bands.
    await expect(page.locator(".chat-sessions-sort")).toContainText("Recent activity");
    await expect(bands(page).first()).toHaveText(/active now/i);

    await page.locator(".chat-sessions-sort").click();
    await page.getByRole("menuitemradio", { name: "Oldest" }).click();

    await expect(page.locator(".chat-sessions-sort")).toContainText("Oldest");
    // A flat order drops the bands for a single named heading, so the reading
    // order and the header always agree.
    await expect(bands(page).first()).toHaveText(/oldest first/i);
    await expect(rows(page).first()).toContainText("Optimize the image pipeline");
  });
});
