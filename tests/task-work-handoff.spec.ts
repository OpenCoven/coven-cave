import { expect, test, type Page } from "@playwright/test";

// #6562 slice 2: a native task chat whose first prompt never landed must not
// open empty. The server hands the prompt back on reuse; the Board's work
// view sends it once. Chat's start page sends such a task to that view
// (`#work-<id>`) instead of opening a plain, empty session.
//
// Daemon-less like every spec here: onboarding dismissed, all routes mocked.

const ISO = "2026-06-12T10:00:00.000Z";
const PROMPT = "Reconcile the stale running cards.";

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

const RESERVED = {
  id: "card-reserved",
  title: "Reserved task — first prompt never sent",
  notes: "",
  status: "backlog",
  priority: "high",
  familiarId: "nova",
  sessionId: "s-reserved",
  nativeSessionId: "s-reserved",
  projectId: "repo-alpha",
  cwd: "/repo/alpha",
  links: [],
  github: [],
  asana: [],
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  lifecycle: "queued",
  lifecycleAt: ISO,
  retryCount: 0,
  maxRetries: 3,
  steps: [],
};

// An existing chat with no turns: Chat shows its start page (ChatEmptyState),
// whose task tiles resume a task's chat.
const EMPTY_CHAT = {
  id: "s-empty",
  title: "Scratch",
  status: "completed",
  origin: "chat",
  harness: "codex",
  familiarId: "nova",
  project_root: "/repo/alpha",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

type Log = { starts: number; sends: number; sendSessions: string[] };

async function mockApp(page: Page, log: Log, baseURL: string | undefined, sessions: unknown[] = [], task: typeof RESERVED = RESERVED) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:code-rail:pinned:v1", "false");
  });
  if (baseURL) await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", url: baseURL }]);
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions } }));
  await page.route("**/api/projects**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        projects: [{ id: "repo-alpha", name: "alpha", root: "/repo/alpha", access: "write", createdAt: ISO, updatedAt: ISO }],
      },
    }),
  );
  await page.route("**/api/board", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { ok: true, cards: [task] } })
      : route.fulfill({ json: { ok: true, card: task } }),
  );
  await page.route("**/api/changes**", (route) => route.fulfill({ json: { ok: true, files: [] } }));
  // Nothing was ever sent: an empty transcript.
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({ json: { ok: true, conversation: { turns: [] }, context: {} } }),
  );
  // The reuse response for an empty native reservation (#6562).
  await page.route("**/api/board/*/chat", (route) => {
    log.starts += 1;
    return route.fulfill({
      json: {
        ok: true,
        reused: true,
        card: task,
        sessionId: "s-reserved",
        familiarId: "nova",
        projectRoot: "/repo/alpha",
        initialPrompt: PROMPT,
        bridge: "native-chat",
      },
    });
  });
  await page.route("**/api/board/*/lifecycle", (route) =>
    route.fulfill({ json: { ok: true, card: { ...task, lifecycle: "dispatched", status: "running" } } }),
  );
  await page.route("**/api/chat/send**", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { prompt?: unknown; sessionId?: unknown };
      if (body.prompt === PROMPT) {
        log.sends += 1;
        log.sendSessions.push(String(body.sessionId));
      }
    }
    return route.fulfill({ json: { ok: true } });
  });
}

test.describe("Task work handoff (#6562)", () => {
  test("a #work link reopens a reserved task and sends its first prompt once", async ({ page, baseURL }) => {
    const log: Log = { starts: 0, sends: 0, sendSessions: [] };
    await mockApp(page, log, baseURL);
    await page.goto(`/?mode=board#work-${RESERVED.id}`);
    await page.waitForSelector(".task-work-cockpit .cave-chat-linear", { timeout: 60_000 });

    await expect.poll(() => log.sends, { timeout: 30_000 }).toBe(1);
    expect(log.starts, "the board asked the server, which handed the prompt back").toBe(1);
    expect(log.sendSessions).toEqual(["s-reserved"]);
    // The hash is consumed, so a reload doesn't send it again.
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
    await page.waitForTimeout(1_000);
    expect(log.sends, "the first prompt is sent exactly once").toBe(1);
  });

  test("Chat's start page sends a native task with an unsent prompt to the Board's work view", async ({ page, baseURL }) => {
    const log: Log = { starts: 0, sends: 0, sendSessions: [] };
    // Chat's task rail lists open columns (running, review, blocked, inbox).
    await mockApp(page, log, baseURL, [EMPTY_CHAT], { ...RESERVED, status: "inbox" });
    await page.goto(`/#chat-${EMPTY_CHAT.id}`);
    const tile = page.getByRole("button", { name: /Resume 'Reserved task — first prompt never sent'/ });
    await tile.waitFor({ timeout: 60_000 });
    await tile.click();

    await page.waitForSelector(".task-work-cockpit .cave-chat-linear", { timeout: 60_000 });
    await expect.poll(() => log.sends, { timeout: 30_000 }).toBe(1);
    // The start page asked once; the Board took the parked prompt without a second start.
    expect(log.starts).toBe(1);
    expect(log.sendSessions).toEqual(["s-reserved"]);
    await page.waitForTimeout(1_000);
    expect(log.sends).toBe(1);
  });
});
