import { expect, test, type Page } from "@playwright/test";

// Verifies the chat surface landing: opening chat (home-first boot means via
// ?mode=chat) paints the brand-new-chat dashboard (ChatNewDashboard — the
// work-led rail + open-work board relocated off Home — over ChatView's real
// composer) without waiting for /api/sessions/list — the fetch that used to
// gate the boot-compose effect and left users on the ChatList skeleton wall
// for its full duration. Also pins the landing affordances: the live board's
// open-work rows, quick-start rows that seed (never send) the composer, and
// the hidden-not-disabled pre-session Voice button.
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
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => new Promise(() => {}),
      },
    });
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: FAMILIARS }));
  await page.route("**/api/board**", (route) => route.fulfill({ json: BOARD }));
}

test.describe("chat boot landing", () => {
  test("dismissed E2E baseline keeps onboarding closed with the seeded Queue project", async ({ page }) => {
    await seed(page);
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));

    await page.goto("/?mode=chat");
    await expect(page.getByTestId("chat-new-dashboard")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

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

    await page.goto("/?mode=chat");
    await expect(page.getByTestId("chat-new-dashboard")).toBeVisible({ timeout: 45_000 });
    expect(sessionsFulfilled).toBe(false);

    // Unblock the fetch and confirm the settled landing is intact.
    releaseSessions();
    await expect(page.locator(".home-dash__eyebrow")).toBeVisible();
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
    await expect(page.getByTestId("chat-new-dashboard")).toHaveCount(0);
    await expect(page.locator(".cave-chat-empty")).toHaveCount(0);

    releaseSessions();
    await expect(takeover).toHaveCount(0, { timeout: 15_000 });
  });

  test("landing surfaces board work, quick-start seeds the composer, voice call from turn zero", async ({ page }) => {
    await seed(page);
    let voiceConversationCreateCalls = 0;
    await page.route("**/api/sessions/list**", (route) =>
      route.fulfill({ json: { ok: true, sessions: [] } }),
    );
    // Deterministic needs-you tier: the dashboard also reads the inbox.
    await page.route("**/api/inbox", (route) => route.fulfill({ json: { ok: true, items: [] } }));
    await page.route("**/api/chat/conversation", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      voiceConversationCreateCalls += 1;
      return route.fulfill({ json: { ok: true, sessionId: "voice-s1" } });
    });
    await page.route("**/api/chat/conversation/**", (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({ json: { ok: true, deleted: true } });
      }
      return route.fulfill({ json: { ok: true, conversation: { turns: [] }, context: { task: null, github: [] } } });
    });

    await page.goto("/?mode=chat");
    const dash = page.getByTestId("chat-new-dashboard");
    await expect(dash).toBeVisible({ timeout: 45_000 });

    // The live board's inbox card surfaces as an open-work row with the
    // visual Resume CTA…
    const workRow = dash.locator(".home-dash__work-row", { hasText: "Fix login flow" });
    await expect(workRow).toBeVisible();
    await expect(workRow).toContainText("Resume");
    // …and the headline counts it.
    await expect(dash.locator(".home-dash__headline")).toContainText("1 thread open.");

    // Quick start seeds the composer, never auto-sends.
    await dash.locator(".home-dash__quick-row", { hasText: "Summarise today" }).click();
    const composer = page.getByPlaceholder(/Message Nova/);
    await expect(composer).toHaveValue(/Summarise everything that happened today\./);
    await expect(dash).toBeVisible();

    // Voice no longer needs a session: the call action is a direct button from
    // turn zero, while the overflow has moved to the dedicated Chat options trigger.
    const voiceCall = page.getByRole("button", { name: "Voice call" });
    await expect(voiceCall).toBeVisible();
    await expect(voiceCall).toBeEnabled();
    const createVoiceConversation = page.waitForResponse(
      (response) => response.url().endsWith("/api/chat/conversation") && response.request().method() === "POST",
    );
    await voiceCall.click();
    await createVoiceConversation;
    expect(voiceConversationCreateCalls).toBe(1);
    const voiceDialog = page.getByRole("dialog", { name: "Nova" });
    await expect(voiceDialog).toBeVisible();
    await expect(page.getByText("Requesting microphone…")).toBeVisible();
    await voiceDialog.getByRole("button", { name: "End call" }).click();
    await expect(voiceDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Chat options" }).click();
    // The unified + menu folds the old Improve section into enhance rows.
    await expect(page.getByRole("menuitem", { name: "Enhance prompt" })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
