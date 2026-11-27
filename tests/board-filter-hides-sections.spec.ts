import { expect, test } from "@playwright/test";

// #6561: a status excluded in the Tasks Filter menu is not drawn at all. Its
// Kanban column leaves the board instead of staying as an empty column, and
// Select all brings it back. A status that is merely empty keeps its column.
//
// Daemon-less (COVEN_CAVE_E2E=1): every API is a scoped page.route mock.

const ISO = "2026-11-22T12:00:00Z";
const card = (id: string, title: string, status: string, lifecycle = "queued", cwd: string | null = null) => ({
  id, title, notes: "", status, priority: "medium", familiarId: null, sessionId: null, cwd, projectId: null,
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
    // A folder but no project: it belongs in the "No project" lane, and the
    // filter must call it that too, or unchecking the lane leaves it drawn.
    card("f1", "Loose folder task", "inbox", "queued", "/Users/demo/loose-folder"),
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
  await expect(page.locator(".board-kanban-card")).toHaveCount(4, { timeout: 60_000 });
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

const openBoard = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 60_000 });
  await page.keyboard.press("Meta+3");
  await expect(page.locator(".board-kanban-card, .board-card-stack__section").first()).toBeVisible({ timeout: 60_000 });
};

test("Project grouping keeps status filters reachable and hides the No project lane", async ({ page }) => {
  await openBoard(page);
  const filter = page.getByRole("button", { name: /^Filter/ });
  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: "Done" }).click();
  // Escape closes the menu and returns focus to the Filter button.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Filter sections" })).toHaveCount(0);
  await expect(filter).toBeFocused();
  await page.getByRole("button", { name: "Project", exact: true }).click();

  // The hidden status is still listed, still counted, and still hidden.
  await expect(filter).toContainText("1");
  await expect(page.locator('[data-kanban-column="done"]')).toHaveCount(0);
  await filter.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Done" })).toHaveAttribute("aria-checked", "false");
  // The folder-only card is filed under "No project", not its folder name.
  await expect(page.getByRole("menuitemcheckbox", { name: "loose-folder" })).toHaveCount(0);
  await expect(page.locator(".board-swimlane")).toHaveCount(1);
  await page.getByRole("menuitemcheckbox", { name: "No project" }).click();
  await expect(page.locator(".board-swimlane")).toHaveCount(0);

  // Everything hidden: say so, and offer the way back.
  await page.keyboard.press("Escape");
  await expect(page.getByText("No tasks match your filters")).toBeVisible();
  await page.getByRole("button", { name: "Show all sections" }).click();
  await expect(page.getByText("Loose folder task")).toBeVisible();
  await expect(page.getByText("Shipped already")).toBeVisible();
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("Excluding a status removes its card-stack section and tab", async ({ page }) => {
    await openBoard(page);
    const tabs = page.getByRole("tablist", { name: "Filter by status" });
    await tabs.getByRole("tab", { name: /^Done/ }).click();
    await expect(page.getByRole("button", { name: "New Done task" })).toBeVisible();

    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "Done" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Filter sections" })).toHaveCount(0);

    await expect(tabs.getByRole("tab", { name: /^Done/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New Done task" })).toHaveCount(0);
    // The Done tab was selected, so the stack falls back to All, not nothing.
    await expect(page.getByRole("button", { name: "New Backlog task" })).toBeVisible();
    await expect(page.getByText("Draft the plan")).toBeVisible();
  });
});
