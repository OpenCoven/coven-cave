import { expect, test, type Page } from "@playwright/test";
import type { Card } from "../src/lib/cave-board-types";
import { orchestrationFingerprint } from "../src/lib/task-dependency-review";

// These journeys also pay for the code-split Board and Chart Room on cold runs.
test.setTimeout(180_000);

const stamp = "2026-09-09T14:00:00.000Z";
const card = (id: string, title: string): Card => ({
  id, title, notes: "", status: "backlog", priority: "medium",
  familiarId: "cody", sessionId: null, cwd: null, projectId: null,
  links: [], github: [], asana: [], labels: [], steps: [],
  createdAt: stamp, updatedAt: stamp, lifecycle: "queued", lifecycleAt: stamp,
  retryCount: 0, maxRetries: 3, dependencies: [],
});

async function setup(page: Page) {
  const state = {
    cards: Array.of<Card>(card("draft", "Draft dependency task"), {
      ...card("reviewed", "Reviewed independent task"),
      dependencyReview: { reviewedAt: stamp },
    }),
    patches: [] as Record<string, unknown>[],
    creates: [] as Record<string, unknown>[],
    failNext: false,
  };
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true, familiars: [{ id: "cody", display_name: "Cody", role: "Navigator", status: "active" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route(/\/api\/roles(\?|$)/, (route) => route.fulfill({ json: { roles: [] } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [
    { id: "e2e-project", name: "Dependency test", root: process.cwd(), access: "write", createdAt: stamp, updatedAt: stamp },
  ] } }));
  await page.route("**/api/workflows**", (route) => route.fulfill({ json: { ok: true, workflows: [] } }));
  await page.route("**/api/skills**", (route) => route.fulfill({ json: { ok: true, skills: [] } }));
  await page.route("**/api/escalations**", (route) => route.fulfill({ json: { ok: true, count: 0 } }));
  await page.route(/\/api\/board\/[^/?]+$/, async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    const current = state.cards.find((item) => item.id === id);
    if (!current) return route.fulfill({ status: 404, json: { error: "Task not found." } });
    if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, card: current } });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.patches.push(body);
    if (state.failNext) {
      state.failNext = false;
      return route.fulfill({ status: 503, json: { error: "Dependency save unavailable. Try again." } });
    }
    if (body.expectedOrchestration !== undefined && body.expectedOrchestration !== orchestrationFingerprint(current)) {
      return route.fulfill({ status: 409, json: { error: "Dependencies changed. Reload latest before saving." } });
    }
    const { expectedOrchestration: _guard, dependencyReviewAction: review, ...patch } = body;
    const next = { ...current, ...patch };
    if (review === "review") next.dependencyReview = { reviewedAt: stamp };
    else if (review === "unreview" || orchestrationFingerprint(current) !== orchestrationFingerprint(next)) next.dependencyReview = null;
    state.cards = state.cards.map((item) => item.id === id ? next : item);
    return route.fulfill({ json: { ok: true, card: next } });
  });
  await page.route(/\/api\/board(?:\?.*)?$/, (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Partial<Card>;
      state.creates.push(body);
      if (body.status === "blocked" && (!body.dependencies?.length || !body.primaryBlockerId || !body.nextStep?.summary)) {
        return route.fulfill({ status: 422, json: { ok: false, error: "orchestration_invalid", errors: [{ message: "Blocked tasks need a dependency, primary blocker, and next action." }] } });
      }
      const created = { ...card("created", "New task"), ...body };
      state.cards.push(created);
      return route.fulfill({ json: { ok: true, card: created } });
    }
    return route.fulfill({ json: { ok: true, cards: state.cards } });
  });
  await page.goto("/");
  await page.locator(".shell-frame").waitFor({ timeout: 60_000 });
  return state;
}

async function enter(page: Page, mode: string, selector: string) {
  await expect(async () => {
    await page.evaluate((value) => window.dispatchEvent(new CustomEvent("cave:navigate-mode", {
      detail: { mode: value },
    })), mode);
    await expect(page.locator(selector)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
}

test("Board explicitly reviews empty dependencies, preserves failures, and reloads persisted review", async ({ page }) => {
  const state = await setup(page);
  await enter(page, "board", ".board-shell");
  await page.locator('.board-kanban-card[data-card-id="draft"]').click();
  const review = page.getByRole("button", { name: "Save and mark reviewed", exact: true });
  await expect(review).toBeVisible();
  expect(state.patches).toHaveLength(0);
  state.failNext = true;
  await review.click();
  await expect(page.getByText("Dependency save unavailable. Try again.", { exact: true })).toBeVisible();
  expect(state.cards[0].dependencyReview).toBeUndefined();
  await review.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => state.cards[0].dependencyReview?.reviewedAt).toBe(stamp);
  expect(state.patches.at(-1)).toMatchObject({
    dependencies: [], dependencyReviewAction: "review", expectedOrchestration: expect.any(String),
  });
  await page.reload();
  await enter(page, "board", ".board-shell");
  await page.locator('.board-kanban-card[data-card-id="draft"]').click();
  const unreview = page.getByRole("button", { name: "Mark unreviewed", exact: true });
  await expect(unreview).toBeVisible();
  await unreview.click();
  await expect.poll(() => state.cards[0].dependencyReview).toBeNull();
  const editor = page.getByRole("region", { name: "Edit task dependencies" });
  await editor.getByLabel("Next step summary", { exact: true }).fill("Review the deployment");
  state.cards[0] = {
    ...state.cards[0],
    nextStep: { summary: "Review the latest release", requiresApproval: false, origin: "human", updatedAt: stamp },
  };
  await editor.getByRole("button", { name: "Save dependencies", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("changed elsewhere");
  await expect(editor.getByLabel("Next step summary", { exact: true })).toHaveValue("Review the deployment");
  await editor.getByRole("button", { name: "Reload latest", exact: true }).click();
  await expect(editor.getByLabel("Next step summary", { exact: true })).toHaveValue("Review the latest release");
  await editor.getByRole("checkbox", { name: /Reviewed independent task/ }).check();
  await editor.getByRole("checkbox", { name: "Requires human approval", exact: true }).check();
  await editor.getByRole("button", { name: "Save dependencies", exact: true }).click();
  await expect.poll(() => state.cards[0].dependencies?.length).toBe(1);
  expect(state.cards[0].dependencies?.[0]).toMatchObject({ kind: "task", taskId: "reviewed", origin: "human" });
  expect(state.cards[0].nextStep?.requiresApproval).toBe(true);
});

test("Chart Room exposes review text, filters every task lens, and opens canonical editing on one click", async ({ page }) => {
  await setup(page);
  await enter(page, "surface:navigator-chart-room", ".role-surface-room--chart");
  const room = page.locator(".role-surface-room--chart");
  await expect(room.getByLabel("Dependencies unreviewed", { exact: true }).first()).toBeVisible();
  await expect(room.getByLabel("Dependencies reviewed", { exact: true }).first()).toBeVisible();
  await room.getByRole("button", { name: "Unreviewed dependencies", exact: true }).click();
  for (const lens of ["Flow", "Graph", "Orchestration", "Table"]) {
    await room.getByRole("button", { name: lens, exact: true }).click();
    await expect(room.getByLabel("Dependencies reviewed", { exact: true })).toHaveCount(0);
    await expect(room.getByLabel("Dependencies unreviewed", { exact: true }).first()).toBeVisible();
  }
  await room.getByRole("button", { name: "Graph", exact: true }).click();
  await room.locator(".cr-graph__node").filter({ hasText: "Draft dependency task" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Save and mark reviewed", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Trace dependencies", exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await room.getByRole("button", { name: "Orchestration", exact: true }).click();
  await room.locator('.cr-orch__row[data-lane="step"]').filter({ hasText: "Draft dependency task" }).first().click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Save dependencies", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/task-dependency-editor.png", fullPage: true });
});

test("blocked task creation exposes orchestration fields and preserves rejected input", async ({ page }) => {
  const state = await setup(page);
  await enter(page, "board", ".board-shell");
  await page.getByRole("button", { name: /Add to blocked/i }).click();
  const modal = page.getByRole("dialog", { name: /New task/ });
  await expect(modal).toBeVisible();
  await modal.getByLabel("Title", { exact: true }).fill("Blocked release");
  await expect(modal.locator("details").filter({ hasText: "Dependencies and next action" })).toHaveAttribute("open", "");
  await modal.getByRole("button", { name: "Create", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Blocked tasks need");
  await expect(modal.getByLabel("Title", { exact: true })).toHaveValue("Blocked release");
  expect(state.creates).toHaveLength(1);
  expect(state.creates[0]).toMatchObject({ status: "blocked", dependencies: [], primaryBlockerId: null, nextStep: null });
  await modal.getByRole("button", { name: "Add dependency", exact: true }).click();
  await modal.getByLabel("Label", { exact: true }).fill("Approve the release");
  await modal.getByLabel("Stable reference", { exact: true }).fill("decision:release");
  await modal.getByLabel("Next step summary", { exact: true }).fill("Request release approval");
  await modal.getByRole("checkbox", { name: "Pin primary blocker", exact: true }).check();
  await modal.getByRole("checkbox", { name: "Requires human approval", exact: true }).check();
  await modal.getByRole("button", { name: "Create", exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(state.creates).toHaveLength(2);
  expect(state.cards.find((item) => item.id === "created")).toMatchObject({
    title: "Blocked release", status: "blocked", primaryBlockerId: expect.any(String),
    primaryBlockerPinned: true,
    dependencies: [{ kind: "external", label: "Approve the release", ref: "decision:release", state: "unresolved" }],
    nextStep: { summary: "Request release approval", requiresApproval: true },
  });
});
