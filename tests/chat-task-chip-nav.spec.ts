import { expect, test, type Page } from "@playwright/test";

// Repro for: clicking the linked-task chip in the chat header should navigate
// to the board and open that card's inspector (expanded details). User reports
// it lands on the Chat List instead. We mock a board-originated session whose
// conversation carries linked task context, open it, then click the chip.

const ISO = "2026-06-12T10:00:00.000Z";
const CARD_ID = "card-vcs-review";

const SESSION = {
  id: "s-task",
  title: "Task: Review Version Control in Cave",
  status: "running",
  origin: "board",
  project_root: "/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local:/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

const CARD = {
  id: CARD_ID,
  title: "Review Version Control in Cave",
  notes: "Audit the changes panel.",
  status: "backlog",
  priority: "medium",
  familiarId: "nova",
  sessionId: "s-task",
  cwd: "/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  links: [],
  github: [],
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  lifecycle: "queued",
  lifecycleAt: ISO,
  retryCount: 0,
  maxRetries: 2,
  steps: [],
};

const CONTEXT = {
  task: {
    id: CARD_ID,
    title: CARD.title,
    status: CARD.status,
    priority: CARD.priority,
    lifecycle: CARD.lifecycle,
    labels: [],
    cwd: CARD.cwd,
    notes: CARD.notes,
  },
  github: [],
};

async function setup(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: { turns: [{ id: "t1", role: "assistant", text: "On it.", createdAt: ISO }] },
        context: CONTEXT,
      },
    }),
  );
  await page.route("**/api/board**", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { ok: true, cards: [CARD] } });
    }
    return route.continue();
  });
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
}

test("task chip navigates to the board card inspector, not the chat list", async ({ page }) => {
  await setup(page);

  // Open the task chat from the chat-mode sidebar (session navigator).
  const sidebar = page.locator(".chat-sidebar");
  await sidebar.getByText("Review Version Control in Cave", { exact: false }).first().click();

  // The linked-task chip appears in the chat header. Its accessible name is
  // the chip's own text content ("Task … backlog medium"), which the status/
  // priority suffix distinguishes from the sidebar's session button.
  const chip = page.getByRole("button", { name: /Review Version Control in Cave backlog medium/ });
  await expect(chip).toBeVisible({ timeout: 30_000 });

  // Click it → leaves the chat surface and opens the board card inspector.
  // Regression guard: writing `#card-<id>` used to synchronously fire the
  // workspace popstate handler, which bounced back to the chat list (mode was
  // still "chat" before the intent's setMode("board") committed) — stranding
  // the user on the list instead of the task.
  await chip.click();

  await expect(page.getByRole("dialog", { name: "Card inspector" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chat-surface")).toHaveCount(0);
});
