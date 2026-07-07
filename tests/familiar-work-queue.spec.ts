import { expect, test, type Page } from "@playwright/test";

// Familiar Work Queue (cave-hlv.4) — the beads + PR control tower surface.
// Drives the mode entirely off mocked /api/beads (ready beads) and
// /api/beads/prs (the bridge's classified open + merged PRs). The surface owns
// no PR truth of its own, so mocking those two endpoints fully determines the
// lanes. Daemon-less (COVEN_CAVE_E2E=1); navigation is via the cave:navigate-mode
// event since Work Queue is a quiet, shortcut-less destination.

const READY_BEADS = [
  { id: "cave-aa1", title: "Harden the sync path", priority: 1, status: "open", issue_type: "feature", labels: ["familiar:kitty", "surface:github"], updated_at: null, comment_count: 0 },
  { id: "cave-bb2", title: "iOS profile avatar", priority: 2, status: "open", issue_type: "feature", labels: ["familiar:nova", "surface:ios"], updated_at: null, comment_count: 0 },
  // cave-open is the post-merge-cleanup bead (merged PR #90). comment_count: 0
  // means no recorded verification yet → Close is gated until a handoff note.
  { id: "cave-open", title: "Merged but unclosed", priority: 2, status: "open", issue_type: "feature", labels: ["familiar:kitty"], updated_at: null, comment_count: 0 },
  { id: "cave-epic", title: "An epic container", priority: 1, status: "open", issue_type: "epic", labels: ["familiar:nova"], updated_at: null, comment_count: 0 },
];

const NOW = Date.now();
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

// These are already-classified bridge summaries (the endpoint runs the classifier).
const OPEN_PRS = [
  { number: 101, title: "Fix the flaky sync", url: "https://gh/pull/101", lane: "checks-failing", beadIds: ["cave-aa1"], checkStatus: "failing", reviewDecision: "UNKNOWN", mergeStateStatus: "BLOCKED", headRefName: "fix/cave-aa1", updatedAt: iso(40) },
  { number: 102, title: "Ship the widget", url: "https://gh/pull/102", lane: "ready-to-merge", beadIds: ["cave-cc9"], checkStatus: "passing", reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", headRefName: "feat/cave-cc9", updatedAt: iso(2) },
  { number: 103, title: "Unlinked spike", url: "https://gh/pull/103", lane: "needs-review", beadIds: [], checkStatus: "passing", reviewDecision: "UNKNOWN", mergeStateStatus: "CLEAN", headRefName: "spike/x", updatedAt: iso(3) },
];

const MERGED_PRS = [
  { number: 90, title: "Landed change", url: "https://gh/pull/90", beadIds: ["cave-open"], mergedAt: iso(1) },
];

async function gotoWorkQueue(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "kitty");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          { id: "kitty", display_name: "Kitty", role: "Builder", status: "active", icon: "ph:sparkle-fill" },
          { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  // Regex matchers (not globs): glob `?` matches any char, so `/api/beads?…`
  // would also catch `/api/beads/prs`. These are unambiguous — /prs vs the
  // ?-queried ready list.
  await page.route(/\/api\/beads\/prs/, (route) =>
    route.fulfill({ json: { ok: true, open: OPEN_PRS, merged: MERGED_PRS } }),
  );
  await page.route(/\/api\/beads\?/, (route) => route.fulfill({ json: { ok: true, data: READY_BEADS } }));

  await page.goto("/");
  // The shell must be mounted before the mode-switch listener exists; dispatch
  // once the nav is present, then re-fire until the surface appears so a slow
  // hydration (cold `next dev` compile) can't lose the event to a race.
  await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "familiar-work-queue" } })),
    );
    await expect(page.locator(".fwq")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe("familiar work queue (PR control tower)", () => {
  test("renders lanes from the beads + PR bridge and exposes cleanup/claim actions", async ({ page }) => {
    await gotoWorkQueue(page);
    const fwq = page.locator(".fwq");

    // Header actionable count: 101(fail) + 102(ready) + 103(review) + cave-bb2(no-PR) + 90(cleanup) = 5 actionable.
    await expect(fwq.getByText(/5 actionable/)).toBeVisible();

    // Every acceptance lane the mock populates renders, in fix→land→review→bead order.
    await expect(fwq.getByRole("region", { name: "Checks failing" })).toBeVisible();
    await expect(fwq.getByRole("region", { name: "Needs review" })).toBeVisible();
    await expect(fwq.getByRole("region", { name: "Ready to merge" })).toBeVisible();
    await expect(fwq.getByRole("region", { name: "No open PR" })).toBeVisible();
    await expect(fwq.getByRole("region", { name: "Post-merge cleanup" })).toBeVisible();

    // PR + bead identity surfaces truthfully.
    await expect(fwq.getByText("#101")).toBeVisible();
    await expect(fwq.getByText("cave-aa1", { exact: true })).toBeVisible();
    // Stale PR (40h) is flagged.
    await expect(fwq.getByText("stale", { exact: true }).first()).toBeVisible();

    // The epic is excluded from the queue (containers aren't work).
    await expect(fwq.getByText("An epic container")).toHaveCount(0);

    // Familiar rollup chips (label-derived) act as filters.
    const kittyChip = fwq.getByRole("button", { name: /Kitty/ });
    await expect(kittyChip).toBeVisible();
    await expect(fwq.getByRole("button", { name: /Nova/ })).toBeVisible();

    // Cleanup lane offers "Close bead"; no-open-PR lane offers "Claim".
    const cleanup = fwq.getByRole("region", { name: "Post-merge cleanup" });
    await expect(cleanup.getByRole("button", { name: "Close bead" })).toBeVisible();
    const noPr = fwq.getByRole("region", { name: "No open PR" });
    await expect(noPr.getByRole("button", { name: "Claim" })).toBeVisible();

    // Filtering by Nova drops Kitty-owned lanes (checks-failing was Kitty's).
    await page.getByRole("button", { name: /Nova/ }).click();
    await expect(fwq.getByRole("region", { name: "Checks failing" })).toHaveCount(0);
    await expect(fwq.getByRole("region", { name: "No open PR" })).toBeVisible(); // cave-bb2 is Nova's
  });

  test("claiming a no-open-PR bead posts to the beads adapter", async ({ page }) => {
    let claimBody: unknown = null;
    await page.route("**/api/beads", async (route) => {
      // POST claim/close land here (the GET ready list uses the ?-suffixed matcher).
      if (route.request().method() === "POST") {
        claimBody = route.request().postDataJSON();
        await route.fulfill({ json: { ok: true, data: { id: "cave-bb2", status: "in_progress" } } });
        return;
      }
      await route.fulfill({ json: { ok: true, data: READY_BEADS } });
    });
    await gotoWorkQueue(page);

    const noPr = page.locator(".fwq").getByRole("region", { name: "No open PR" });
    await noPr.getByRole("button", { name: "Claim" }).click();
    await expect.poll(() => claimBody).toEqual({ action: "claim", id: "cave-bb2" });
  });

  test("cleanup Close is gated on a handoff note; adding one posts a comment and unlocks it", async ({ page }) => {
    let commentBody: unknown = null;
    await page.route("**/api/beads", async (route) => {
      if (route.request().method() === "POST") {
        commentBody = route.request().postDataJSON();
        await route.fulfill({ json: { ok: true, data: { id: "cave-open" } } });
        return;
      }
      await route.fulfill({ json: { ok: true, data: READY_BEADS } });
    });
    await gotoWorkQueue(page);

    const cleanup = page.locator(".fwq").getByRole("region", { name: "Post-merge cleanup" });
    // No evidence yet → Close is disabled and the reason is spelled out.
    await expect(cleanup.getByRole("button", { name: "Close bead" })).toBeDisabled();
    await expect(cleanup.getByText(/Add a handoff note to record verification/)).toBeVisible();

    // Record a handoff note through the inline composer.
    await cleanup.getByRole("button", { name: /Add a handoff note to cave-open/ }).click();
    await cleanup.getByRole("textbox", { name: /Handoff note for cave-open/ }).fill("Verified: lanes render, close gated.");
    await cleanup.getByRole("button", { name: "Add note" }).click();

    // The note posts as a comment on the bead…
    await expect.poll(() => commentBody).toEqual({
      action: "comment",
      id: "cave-open",
      comment: "Verified: lanes render, close gated.",
    });
    // …and Close unlocks (optimistic, without waiting for a re-read).
    await expect(cleanup.getByRole("button", { name: "Close bead" })).toBeEnabled();
  });
});
