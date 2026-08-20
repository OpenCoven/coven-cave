import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

// The ultimate Enhance (cave-b6c2): the composer's Enhance action (now an
// item in the "+" menu, chat revamp 1d) streams a real rewrite from the
// familiar via /api/chat/send (SSE), applies it in place when the draft is
// untouched, downgrades to a suggestion strip when the user typed mid-flight
// (the old copies' race bug), falls back to the local rule engine on stream
// failure, and exposes intent variants behind the Enhance-options view.
//
// Daemon-less: /api/chat/send is mocked with SSE frames; the home surface is
// driven through the standard familiar/session mocks. Desktop-only — the
// control is identical on chat and quick-chat (pinned in
// composer-enhance.test.ts), so one surface exercises the shared behavior.

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

const ENHANCED = "Investigate the login regression and outline a fix plan.";
const NEXT_PATH_RESPONSE = "The login path is ready to verify.\n<coven:next-paths>\n- [reply rationale=\"Verify the changed login flow\" evidence=\"message:a-evidence\"] Verify the login flow\n</coven:next-paths>";
const ISO = "2026-08-19T14:00:00.000Z";
const PROJECT_ROOT = process.cwd();
const CHAT_SESSION = {
  id: "s-agentic-enhance",
  title: "Agentic enhancement evidence",
  status: "idle",
  project_root: PROJECT_ROOT,
  harness: "codex",
  familiarId: "nova",
  model: "openai/gpt-5.5",
  runtime: `local:${PROJECT_ROOT}`,
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
  attention: { state: "none", since: null, reason: null },
};
const CHAT_CONTEXT = {
  task: {
    id: "task-enhance",
    title: "Fix the login regression",
    status: "inbox",
    priority: "high",
    lifecycle: "queued",
    labels: ["auth"],
    cwd: PROJECT_ROOT,
    notes: "Keep the session scope and prove the fix.",
  },
  github: [],
};

function sseBody(text: string): string {
  return [
    `data: ${JSON.stringify({ kind: "assistant_chunk", text: `<enhanced>${text}</enhanced>` })}`,
    "",
    `data: ${JSON.stringify({ kind: "done", sessionId: "enh-1" })}`,
    "",
    "",
  ].join("\n");
}

function fulfillSse(route: Route, text: string) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: sseBody(text),
  });
}

function fulfillFrames(route: Route, frames: Array<Record<string, unknown>>) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${frames.map((frame) => `data: ${JSON.stringify(frame)}`).join("\n\n")}\n\n`,
  });
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ ...FAMILIAR, harness: "claude" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
}

async function openHome(page: Page) {
  await page.goto("/?mode=home");
  const draft = page.getByRole("textbox", { name: "Ask anything" });
  await expect(draft).toBeVisible({ timeout: 45_000 });
  return draft;
}

/** Smart enhance is one item deep in the composer "+" menu (chat revamp 1d). */
async function clickEnhance(page: Page) {
  await page.getByRole("button", { name: "Composer actions" }).click();
  const menu = page.getByRole("menu", { name: "Composer actions" });
  await expect(menu.getByRole("menuitem", { name: "Enhance prompt" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Enhance prompt" }).click();
}

function homeEnhanceStatus(page: Page, text: string) {
  return page.locator(".home-composer-root").getByRole("status").filter({ hasText: text });
}

type ChatFixture = {
  enhancementRequests: Array<Record<string, unknown>>;
  chatRequests: Array<Record<string, unknown>>;
  modelPatches: Array<Record<string, unknown>>;
  stopRequests: Array<Record<string, unknown>>;
};

async function seedChat(
  page: Page,
  handleEnhance: (route: Route, request: Record<string, unknown>, fixture: ChatFixture) => Promise<void>,
): Promise<ChatFixture> {
  const fixture: ChatFixture = {
    enhancementRequests: [],
    chatRequests: [],
    modelPatches: [],
    stopRequests: [],
  };
  let model = "openai/gpt-5.5";
  let chatReplySent = false;
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ ...FAMILIAR, harness: "codex", model }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [CHAT_SESSION] } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: {
          activeLeafId: chatReplySent ? "a-next-path" : "a-evidence",
          turns: [
            { id: "u-evidence", role: "user", text: "Please investigate the login regression.", createdAt: ISO },
            {
              id: "a-evidence",
              role: "assistant",
              text: "I found the failing login path.",
              createdAt: ISO,
              durationMs: 100,
            },
            ...(chatReplySent
              ? [{ id: "a-next-path", role: "assistant", text: NEXT_PATH_RESPONSE, createdAt: ISO, durationMs: 100 }]
              : []),
          ],
        },
        context: CHAT_CONTEXT,
      },
    }),
  );
  await page.route("**/api/chat/model-state**", (route) => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      fixture.modelPatches.push(patch);
      if (typeof patch.model === "string") model = patch.model;
    }
    return route.fulfill({
      json: {
        ok: true,
        state: {
          familiarId: "nova",
          runtime: null,
          harness: "codex",
          effectiveModel: model,
          source: "session",
          applicationState: "saved",
          reason: "e2e",
        },
      },
    });
  });
  await page.route("**/api/board", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/board/task-enhance", (route) =>
    route.fulfill({ json: { ok: true, card: { ...CHAT_CONTEXT.task, status: "done", lifecycle: "completed" } } }),
  );
  await page.route("**/api/chat/stop", (route) => {
    fixture.stopRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/chat/send", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    if (request.origin === "enhance") {
      fixture.enhancementRequests.push(request);
      await handleEnhance(route, request, fixture);
      return;
    }
    if (request.origin === "journal") {
      await fulfillFrames(route, [{ kind: "done", sessionId: CHAT_SESSION.id }]);
      return;
    }
    fixture.chatRequests.push(request);
    chatReplySent = true;
    await fulfillFrames(route, [
      {
        kind: "assistant_chunk",
        text: NEXT_PATH_RESPONSE,
      },
      { kind: "done", sessionId: CHAT_SESSION.id },
    ]);
  });
  return fixture;
}

async function openChat(page: Page) {
  await page.goto(`/?mode=chat#chat-${CHAT_SESSION.id}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  const draft = chat.getByRole("textbox", { name: "Message" });
  await expect(draft).toBeVisible({ timeout: 45_000 });
  await expect(chat.getByText("I found the failing login path.")).toBeVisible();
  await expect(chat.getByRole("button", { name: /^Project: E2E Project · Full/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(chat.getByRole("button", { name: /^Model: GPT-5\.5/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(chat.getByRole("button", { name: "Open linked task: Fix the login regression" })).toBeVisible({
    timeout: 45_000,
  });
  return { chat, draft };
}

async function clickChatEnhance(page: Page, chat: Locator) {
  await chat.getByRole("button", { name: "Tools" }).click();
  const menu = page.getByRole("menu", { name: "Tools" });
  await expect(menu.getByRole("menuitem", { name: "Enhance prompt" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Enhance prompt" }).click();
}

function chatEnhanceStatus(chat: Locator, text: string) {
  return chat.getByRole("status").filter({ hasText: text });
}

function waitForPoliteAnnouncement(page: Page, expected: string) {
  return page.evaluate(({ message, timeoutMs }) => new Promise<void>((resolve, reject) => {
    const region = document.querySelector(
      'div.sr-only[role="status"][aria-live="polite"][aria-atomic="true"]',
    );
    if (!region) {
      reject(new Error("Polite live region is unavailable."));
      return;
    }
    const finish = () => {
      window.clearTimeout(timer);
      observer.disconnect();
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (region.textContent === message) finish();
    });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for polite announcement: ${message}`));
    }, timeoutMs);
    observer.observe(region, { childList: true, subtree: true, characterData: true });
    if (region.textContent === message) finish();
  }), { message: expected, timeoutMs: 15_000 });
}

test.describe("prompt enhance", () => {
  test("legacy Enhance remains available and never sends a chat message when recommendations are disabled", async ({ page }) => {
    await seed(page);
    const sends: Array<Record<string, unknown>> = [];
    await page.route("**/api/chat/send", (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      sends.push(request);
      return fulfillSse(route, ENHANCED);
    });

    const draft = await openHome(page);
    await draft.fill("fix login bug");
    await clickEnhance(page);

    // The rewrite lands in the textarea; the strip flips to applied + Revert.
    await expect(draft).toHaveValue(ENHANCED, { timeout: 15_000 });
    await expect(homeEnhanceStatus(page, "Prompt improved.")).toBeVisible();

    // The run is an ephemeral, hidden, cheap request — never a saved chat.
    expect(sends).toHaveLength(1);
    expect(sends).toEqual([
      expect.objectContaining({ origin: "enhance" }),
    ]);
    expect(sends[0].reasoningEffort).toBe("low");
    expect(sends[0].sessionId).toBeUndefined();
    expect(String(sends[0].prompt)).toContain("fix login bug");
    expect(String(sends[0].prompt)).toContain("Rewrite the user's draft prompt");

    await page.getByRole("button", { name: "Revert enhanced prompt" }).click();
    await expect(draft).toHaveValue("fix login bug");
  });

  test("typing mid-flight never loses the draft — the rewrite becomes a suggestion", async ({ page }) => {
    await seed(page);
    let releaseSse: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseSse = resolve;
    });
    await page.route("**/api/chat/send", async (route) => {
      await gate; // hold the stream until the user has typed over the draft
      return fulfillSse(route, ENHANCED);
    });

    const draft = await openHome(page);
    await draft.fill("fix login bug");
    await clickEnhance(page);
    await expect(page.getByText("Enhancing…")).toBeVisible();

    // Keep typing while the stream is in flight, then let it complete.
    await draft.fill("fix login bug on safari");
    releaseSse();

    // The newer draft is untouched; the rewrite waits in the strip.
    await expect(page.getByRole("button", { name: "Apply enhanced prompt" })).toBeVisible({ timeout: 15_000 });
    await expect(draft).toHaveValue("fix login bug on safari");

    await page.getByRole("button", { name: "Apply enhanced prompt" }).click();
    await expect(draft).toHaveValue(ENHANCED);
    await expect(draft).toBeFocused();
    // Applying from the strip still offers Revert back to the typed draft.
    await page.getByRole("button", { name: "Revert enhanced prompt" }).click();
    await expect(draft).toHaveValue("fix login bug on safari");
    await expect(draft).toBeFocused();
  });

  test("the intent view changes the instruction (Enhance options in the + menu)", async ({ page }) => {
    await seed(page);
    const sends: Array<Record<string, unknown>> = [];
    await page.route("**/api/chat/send", (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      if (request.origin === "enhance") sends.push(request);
      return fulfillSse(route, "Shorter.");
    });

    const draft = await openHome(page);
    await draft.fill("please make this whole thing quite a bit shorter somehow");

    await page.getByRole("button", { name: "Composer actions" }).click();
    const menu = page.getByRole("menu", { name: "Composer actions" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Enhance options" }).click();
    // The intent list is a cascading flyout that portals to document.body, so
    // it lives outside the root menu locator — scope by its own menu role.
    const flyout = page.getByRole("menu", { name: "Enhance options" });
    await expect(flyout).toBeVisible();
    for (const label of ["Smart enhance", "Clarify", "Expand", "Make specific", "Shorten", "Add acceptance criteria"]) {
      await expect(flyout.getByText(label, { exact: true })).toBeVisible();
    }
    await flyout.getByText("Shorten", { exact: true }).click();

    await expect(draft).toHaveValue("Shorter.", { timeout: 15_000 });
    expect(String(sends[0].prompt)).toContain("Compress to the essential ask");
  });

  test("a failed stream falls back to the local rule engine, labelled offline", async ({ page }) => {
    await seed(page);
    await page.route("**/api/chat/send", (route) => route.fulfill({ status: 500, json: { ok: false } }));

    const draft = await openHome(page);
    await draft.fill("explain docker networking");
    await clickEnhance(page);

    // The rule engine's chat shape applies in place, and the strip says so.
    await expect(homeEnhanceStatus(page, "Prompt improved (offline).")).toBeVisible({ timeout: 15_000 });
    await expect(draft).toHaveValue(/Output format:/);
    await page.getByRole("button", { name: "Revert enhanced prompt" }).click();
    await expect(draft).toHaveValue("explain docker networking");
  });
});

test.describe("Chat agentic prompt enhancement", () => {
  test("keeps successful evidence-grounded proposals reviewable and composer-local", async ({ page }) => {
    const fixture = await seedChat(page, async (route) => fulfillSse(route, ENHANCED));
    const { chat, draft } = await openChat(page);
    const tools = chat.getByRole("button", { name: "Tools" });

    await draft.fill("fix login bug");
    await tools.focus();
    await Promise.all([
      waitForPoliteAnnouncement(page, "Prompt enhanced."),
      clickChatEnhance(page, chat),
    ]);

    const applied = chatEnhanceStatus(chat, "Prompt improved.");
    await expect(applied).toBeVisible({ timeout: 15_000 });
    await expect(tools).toBeFocused();
    await expect(draft).toHaveValue(ENHANCED);

    expect(fixture.enhancementRequests).toHaveLength(1);
    expect(String(fixture.enhancementRequests[0]?.prompt)).toContain("Current thread: Agentic enhancement evidence");
    expect(String(fixture.enhancementRequests[0]?.prompt)).toContain("Linked task: Fix the login regression");
    expect(String(fixture.enhancementRequests[0]?.prompt)).toContain("Composer model scope: session:[redacted]");
    expect(fixture.modelPatches).toEqual([]);

    const why = applied.getByText("Why this?", { exact: true });
    await why.click();
    await expect(applied.getByText("Smart enhance was selected to improve the current draft without changing its objective.")).toBeVisible();
    await expect(applied.getByLabel("Evidence")).toContainText("message: Recent chat message");
    await expect(applied.getByLabel("Evidence")).toContainText("task: Linked task");

    const revert = applied.getByRole("button", { name: "Revert enhanced prompt" });
    await revert.focus();
    await page.keyboard.press("Tab");
    await expect(why).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(revert).toBeFocused();

    await Promise.all([
      waitForPoliteAnnouncement(page, "Prompt restored."),
      revert.click(),
    ]);
    await expect(draft).toHaveValue("fix login bug");
    await expect(draft).toBeFocused();
  });

  test("turns a mid-stream Chat edit into an apply-or-dismiss suggestion and cancels stale context", async ({ page }) => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let releaseThird!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const thirdGate = new Promise<void>((resolve) => {
      releaseThird = resolve;
    });
    let resolveThirdDeliveryAttempt!: () => void;
    const thirdDeliveryAttempted = new Promise<void>((resolve) => {
      resolveThirdDeliveryAttempt = resolve;
    });
    let thirdDeliveryAttemptedFlag = false;
    let enhancementAttempt = 0;
    const fixture = await seedChat(page, async (route) => {
      enhancementAttempt += 1;
      const attempt = enhancementAttempt;
      await (attempt === 1 ? firstGate : attempt === 2 ? secondGate : thirdGate);
      try {
        await fulfillSse(route, ENHANCED);
      } catch {
        if (attempt !== 3) throw new Error("Unexpected enhancement delivery abort.");
        // The lifecycle already stopped this exact request, so an aborted
        // fulfill is the expected late-response path.
      } finally {
        if (attempt === 3) {
          thirdDeliveryAttemptedFlag = true;
          resolveThirdDeliveryAttempt();
        }
      }
    });
    const { chat, draft } = await openChat(page);

    await draft.fill("fix login bug");
    await clickChatEnhance(page, chat);
    const loading = chatEnhanceStatus(chat, "Enhancing…");
    await expect(loading).toBeVisible();

    await draft.fill("fix login bug on Safari");
    releaseFirst();

    const suggested = chatEnhanceStatus(chat, "Enhanced version ready");
    await expect(suggested).toBeVisible({ timeout: 15_000 });
    await expect(draft).toHaveValue("fix login bug on Safari");
    const apply = suggested.getByRole("button", { name: "Apply enhanced prompt" });
    const dismiss = suggested.getByRole("button", { name: "Dismiss enhanced prompt" });
    const why = suggested.getByText("Why this?", { exact: true });
    await apply.focus();
    await page.keyboard.press("Tab");
    await expect(dismiss).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(why).toBeFocused();

    await apply.click();
    await expect(draft).toHaveValue(ENHANCED);
    await expect(draft).toBeFocused();
    await chat.getByRole("button", { name: "Revert enhanced prompt" }).click();
    await expect(draft).toHaveValue("fix login bug on Safari");
    await expect(draft).toBeFocused();

    await draft.fill("fix login bug in Firefox");
    await clickChatEnhance(page, chat);
    await expect(loading).toBeVisible();
    await draft.fill("fix login bug in Firefox and Safari");
    releaseSecond();
    await expect(suggested).toBeVisible({ timeout: 15_000 });
    await suggested.getByRole("button", { name: "Dismiss enhanced prompt" }).click();
    await expect(suggested).toBeHidden();
    await expect(draft).toBeFocused();

    await draft.fill("fix login bug with context");
    await clickChatEnhance(page, chat);
    await expect(loading).toBeVisible();
    await expect(() => expect(fixture.enhancementRequests).toHaveLength(3)).toPass({ timeout: 15_000 });
    const thirdRunId = fixture.enhancementRequests[2]?.runId;
    expect(typeof thirdRunId).toBe("string");
    await chat.locator('input[type="file"]').setInputFiles({
      name: "login-regression.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("session evidence"),
    });
    await chat.getByRole("button", { name: "Mark task done: Fix the login regression" }).click();
    await chat.getByRole("button", { name: "Tools" }).click();
    const toolsMenu = page.getByRole("menu", { name: "Tools" });
    await expect(toolsMenu.getByRole("menuitem", { name: "Model & tuning…" })).toBeVisible();
    await toolsMenu.getByRole("menuitem", { name: "Model & tuning…" }).click();
    const runtimeMenu = page.getByRole("menu", { name: "Runtime and model" });
    await expect(runtimeMenu.getByRole("menuitemradio", { name: "GPT-5.4", exact: true })).toBeVisible();
    await runtimeMenu.getByRole("menuitemradio", { name: "GPT-5.4", exact: true }).click();
    expect(fixture.modelPatches).toHaveLength(1);

    await expect(() => expect(
      fixture.stopRequests.some((request) => request.runId === thirdRunId),
    ).toBe(true)).toPass({ timeout: 15_000 });
    releaseThird();
    await thirdDeliveryAttempted;
    expect(thirdDeliveryAttemptedFlag).toBe(true);
    await expect(draft).toHaveValue("fix login bug with context");
    await expect(suggested).toBeHidden();
  });

  test("retries one malformed enhancement frame, then exposes an explicit error", async ({ page }) => {
    const fixture = await seedChat(page, async (route) =>
      fulfillFrames(route, [
        { kind: "assistant_chunk", text: "<enhanced>unterminated prompt" },
        { kind: "done", sessionId: CHAT_SESSION.id },
      ]),
    );
    const { chat, draft } = await openChat(page);
    await draft.fill("fix login bug");
    await clickChatEnhance(page, chat);
    await expect(() => expect(fixture.enhancementRequests).toHaveLength(2)).toPass({ timeout: 15_000 });
    const message = "Recommendations could not be validated. Please try again.";
    const error = chat.getByRole("alert").filter({ hasText: message });
    await expect(error).toBeVisible();
    await expect(draft).toHaveValue("fix login bug");
    await error.getByRole("button", { name: "Dismiss enhance error" }).click();
    await expect(draft).toBeFocused();
  });

  test("keeps reduced-motion loading available through its polite status text", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await seedChat(page, async (route) => {
      await gate;
      await fulfillSse(route, ENHANCED);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { chat, draft } = await openChat(page);

    await draft.fill("fix login bug");
    await clickChatEnhance(page, chat);
    const loading = chatEnhanceStatus(chat, "Enhancing…");
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("role", "status");
    await expect(() => expect(fixture.enhancementRequests).toHaveLength(1)).toPass({ timeout: 10_000 });
    await loading.getByRole("button", { name: "Cancel enhance" }).click();
    release();
  });

  test("cancels a reduced-motion enhancement and lets a contextual next path only fill the composer", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await seedChat(page, async (route) => {
      await gate;
      await fulfillSse(route, ENHANCED);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { chat, draft } = await openChat(page);

    await draft.fill("fix login bug");
    await clickChatEnhance(page, chat);
    const loading = chatEnhanceStatus(chat, "Enhancing…");
    await expect(loading).toBeVisible();
    await expect(() => expect(fixture.enhancementRequests).toHaveLength(1)).toPass({ timeout: 10_000 });
    await loading.getByRole("button", { name: "Cancel enhance" }).click();
    await expect(loading).toBeHidden();
    await expect(draft).toHaveValue("fix login bug");
    await expect(draft).toBeFocused();
    await expect(() => expect(fixture.stopRequests).toHaveLength(1)).toPass({ timeout: 10_000 });
    release();

    await draft.fill("What should I verify next?");
    await chat.getByRole("button", { name: "Send message" }).click();
    const nextPaths = chat.getByRole("group", { name: "Suggested next steps" });
    const reply = nextPaths.getByRole("button", { name: /Reply: Verify the login flow/ });
    await expect(reply).toBeVisible({ timeout: 15_000 });
    await expect(reply).toHaveAccessibleName(/Why this: Verify the changed login flow/);
    await reply.click();
    await expect(draft).toHaveValue("Verify the login flow");
    expect(fixture.chatRequests).toHaveLength(1);
  });
});
