import { expect, test, type Page } from "@playwright/test";

// Verifies the chat boot landing (cave-qvwu): booting into `/` paints the
// zero-turn compose view (ChatEmptyState + composer) without waiting for
// /api/sessions/list — the fetch that used to gate the boot-compose effect
// and left users on the ChatList skeleton wall for its full duration. Also
// pins the landing polish that rode along: board-aware "Continue the task"
// pills, the hidden-not-disabled pre-session Voice button, and the dosed
// "/ for commands" discoverability hint.
//
// Desktop only (compose-first boot is a desktop affordance — mobile keeps
// the thread list as the chat home). /api/familiars, /api/sessions/list and
// /api/board are mocked; no daemon.

const NOW = Date.now();
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

const FAMILIARS = {
  ok: true,
  familiars: [
    { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
  ],
};

const SESSION_S1 = {
  id: "s1",
  title: "Refactor auth flow",
  status: "completed",
  origin: "chat",
  harness: "codex",
  familiarId: "nova",
  project_root: "/repo/alpha",
  exit_code: null,
  archived_at: null,
  created_at: iso(2),
  updated_at: iso(2),
};

// Unassigned inbox card — fair game for this familiar's resume pills.
const BOARD = {
  ok: true,
  cards: [
    {
      id: "c1",
      title: "Fix login flow",
      status: "inbox",
      priority: "medium",
      familiarId: null,
      projectId: null,
      cwd: null,
      createdAt: iso(6),
      updatedAt: iso(5),
    },
  ],
};

async function seed(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: FAMILIARS }));
  await page.route("**/api/board**", (route) => route.fulfill({ json: BOARD }));
}

test.describe("chat boot landing", () => {
  test("compose view paints before the sessions list resolves", async ({ page }) => {
    await seed(page);
    // Hold the sessions fetch hostage until the landing has painted — this
    // proves the boot-compose path is independent of it, with zero timing
    // flake (no fixed delays to outrun a cold-compile CI run).
    let sessionsFulfilled = false;
    let releaseSessions!: () => void;
    const sessionsGate = new Promise<void>((resolve) => {
      releaseSessions = resolve;
    });
    await page.route("**/api/sessions/list**", async (route) => {
      await sessionsGate;
      sessionsFulfilled = true;
      await route.fulfill({ json: { ok: true, sessions: [SESSION_S1] } });
    });

    await page.goto("/");
    await expect(page.locator(".cave-chat-empty")).toBeVisible({ timeout: 45_000 });
    expect(sessionsFulfilled).toBe(false);

    // Unblock the fetch and confirm the settled landing is intact.
    releaseSessions();
    await expect(page.locator(".cave-chat-empty-greeting")).toBeVisible();
  });

  test("a #chat deep link still shows the Opening-chat takeover until sessions settle", async ({ page }) => {
    await seed(page);
    let releaseSessions!: () => void;
    const sessionsGate = new Promise<void>((resolve) => {
      releaseSessions = resolve;
    });
    await page.route("**/api/sessions/list**", async (route) => {
      await sessionsGate;
      await route.fulfill({ json: { ok: true, sessions: [SESSION_S1] } });
    });

    await page.goto("/#chat-s1");
    // The takeover owns the boot while the deep link is unresolved — the
    // loosened compose gate must not flash a compose view over it.
    const takeover = page.getByRole("status").filter({ hasText: "Opening chat…" });
    await expect(takeover).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".cave-chat-empty")).toHaveCount(0);

    releaseSessions();
    await expect(takeover).toHaveCount(0, { timeout: 15_000 });
  });

  test("landing offers a task-resume pill, hides Voice pre-session, and hints at / commands", async ({ page }) => {
    await seed(page);
    await page.route("**/api/sessions/list**", (route) =>
      route.fulfill({ json: { ok: true, sessions: [] } }),
    );

    await page.goto("/");
    const empty = page.locator(".cave-chat-empty");
    await expect(empty).toBeVisible({ timeout: 45_000 });

    // Board-aware pill: the unassigned inbox card surfaces as a task pill…
    const pill = empty.getByRole("button", { name: /Continue the task: Fix login flow/ });
    await expect(pill).toBeVisible();
    await expect(pill).toHaveClass(/cave-chat-empty-prompt--task/);

    // …that inserts into the composer, never auto-sends.
    await pill.click();
    const composer = page.getByPlaceholder(/Message Nova/);
    await expect(composer).toHaveValue(/Continue the task: Fix login flow/);
    await expect(empty).toBeVisible();

    // Voice needs a session; pre-session it is hidden, not disabled.
    await expect(page.getByRole("button", { name: "Voice" })).toHaveCount(0);

    // Dosed discoverability: the ready line mentions the slash entry point.
    await expect(empty.getByText("/ for commands", { exact: false })).toBeVisible();
  });
});
