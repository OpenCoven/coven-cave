import { expect, test } from "@playwright/test";

// #6561: a status excluded in the Tasks Filter menu is not drawn at all. Its
// Kanban column leaves the board instead of staying as an empty column, and
// Select all brings it back. A status that is merely empty keeps its column.
//
// Daemon-less (COVEN_CAVE_E2E=1): every API is a scoped page.route mock.

const ISO = "2026-11-22T12:00:00Z";
const card = (id: string, title: string, status: string, lifecycle = "queued") => ({
  id, title, notes: "", status, priority: "medium", familiarId: null, sessionId: null, cwd: null, projectId: null,
  links: [], github: [], labels: [], createdAt: ISO, updatedAt: ISO, lifecycle, lifecycleAt: ISO,
  retryCount: 0, maxRetries: 3, steps: [],
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/escalations**", (route) => route.fulfill({ json: { ok: true, count: 0 } }));
  await page.route("**/api/board", (route) => route.fulfill({ json: { ok: true, cards: [
    card("b1", "Draft the plan", "backlog"),
    card("i1", "Pick this up", "inbox"),
    card("d1", "Shipped already", "done", "completed"),
  ] } }));
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // The cards are unassigned, so browse All projects and All familiars.
    window.localStorage.setItem("cave:workspace:project-scope:v1", "null");
    window.localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "__all-projects__": [] }));
  });
});

test("Excluding a status in Filter removes its Kanban column until Select all", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 60_000 });
  await page.keyboard.press("Meta+3");
  await expect(page.locator(".board-kanban-card")).toHaveCount(3, { timeout: 60_000 });
  const column = (status: string) => page.locator(`[data-kanban-column="${status}"]`);
  for (const status of ["backlog", "inbox", "running", "review", "blocked", "done"]) {
    await expect(column(status)).toHaveCount(1);
  }

  const filter = page.getByRole("button", { name: /^Filter/ });
  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: "Done" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Review" }).click();

  // Excluded sections are gone entirely, cards or not.
  await expect(column("done")).toHaveCount(0);
  await expect(column("review")).toHaveCount(0);
  await expect(page.getByText("Shipped already")).toHaveCount(0);
  // Everything else stays, including statuses that just have no cards.
  for (const status of ["backlog", "inbox", "running", "blocked"]) {
    await expect(column(status)).toHaveCount(1);
  }

  await page.getByRole("button", { name: "Select all" }).click();
  await expect(column("done")).toHaveCount(1);
  await expect(column("review")).toHaveCount(1);
  await expect(page.getByText("Shipped already")).toBeVisible();
});
