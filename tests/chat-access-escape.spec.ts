import { expect, test, type Page, type Route } from "@playwright/test";

// #6445: a Chat blocked or limited by access gets one in-place action that can
// work. Explore says it is read-only and offers Build for this chat; a ready
// Claude plan offers "Build this plan"; each access refusal names the action
// that clears it, and a runtime blocker never offers a Build that cannot run.
//
// Daemon-less (COVEN_CAVE_E2E=1): the roster, sessions, projects, grants,
// model state and send route are scoped page.route mocks. Listed in
// MOBILE_SURFACE_SPECS so it runs on desktop, Pixel 5 and iPhone 13.

const ISO = "2026-11-10T09:00:00.000Z";
const SESSION_ID = "access-chat";
const PREFS_KEY = "cave:chat-composer-controls:v1";
test.use({ contextOptions: { reducedMotion: "reduce" } });

type Turn = Record<string, unknown>;
type Fixture = {
  access?: "read" | "full";
  projectAccess?: "read" | "write";
  turns?: Turn[];
  buildUnavailable?: string;
  send: (route: Route, count: number) => Promise<void> | void;
};

const READY: Turn = { id: "a1", parentId: null, role: "assistant", text: "Ready for a message.", createdAt: ISO };
// Claude Code 2.1.322 in `-p` plan mode writes its plan under ~/.claude/plans,
// then looks for an ExitPlanMode tool that `-p` does not offer.
const PLANNED: Turn = {
  id: "a1", parentId: null, role: "assistant", createdAt: ISO,
  text: "Plan: rename the helper and update its two callers.",
  tools: [
    { id: "t1", name: "Write", input: "/Users/val/.claude/plans/rename-helper.md", status: "done" },
    { id: "t2", name: "ToolSearch", input: "select:ExitPlanMode", status: "done" },
  ],
};

function stream(events: unknown[]) {
  return { contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") };
}

const ok = (route: Route) => route.fulfill(stream([
  { kind: "text", text: "Done." },
  { kind: "done", sessionId: SESSION_ID },
]));

async function setup(page: Page, fixture: Fixture) {
  const sends: Array<Record<string, unknown>> = [];
  const grantWrites: Array<{ method: string; body: Record<string, unknown> | null }> = [];
  let directAccess: "read" | "write" | null = fixture.projectAccess === "read" ? "read" : "write";
  await page.addInitScript(({ access, key }) => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem(key, JSON.stringify({ permissionMode: access }));
  }, { access: fixture.access ?? "full", key: PREFS_KEY });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "claude", icon: "ph:sparkle-fill" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{ id: SESSION_ID, title: "Access chat", status: "idle", project_root: "/tmp/coven-cave", harness: "claude", familiarId: "nova", model: null, runtime: "local:/tmp/coven-cave", exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "p1", name: "Coven Cave", root: "/tmp/coven-cave", access: directAccess ?? "read" }],
  } }));
  await page.route("**/api/project-grants**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ json: {
        ok: true, accessGroups: [], supremeFamiliarId: null, audit: [], grantChanges: [],
        grants: directAccess ? [{ familiarId: "nova", projectId: "p1", access: directAccess, source: "human", grantedAt: ISO }] : [],
      } });
    }
    const body = request.postDataJSON() as Record<string, unknown> | null;
    grantWrites.push({ method: request.method(), body });
    // Mirrors the route's compare-and-set: a stale precondition changes nothing.
    if (body && "expectedAccess" in body && body.expectedAccess !== directAccess) {
      return route.fulfill({ status: 409, json: { ok: false, code: "grant_changed", current: directAccess,
        error: "This familiar's access to the project changed after it was shown. Review it in Projects, then try again." } });
    }
    if (request.method() === "POST" && (body?.access === "read" || body?.access === "write")) directAccess = body.access;
    if (request.method() === "DELETE") directAccess = null;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true, conversation: { activeLeafId: "a1", turns: fixture.turns ?? [READY] },
  } }));
  await page.route("**/api/vault**", (route) => route.fulfill({ json: { ok: true, mappings: [] } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: {
    ok: true,
    state: { familiarId: "nova", runtime: null, harness: "claude", effectiveModel: null, source: "runtime-default", applicationState: "saved", reason: "e2e", familiarDefaultModel: null },
    ...(fixture.buildUnavailable
      ? { access: { build: { available: false, code: "scoped_write_unavailable", message: fixture.buildUnavailable } } }
      : { access: { build: { available: true } } }),
  } }));
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON());
    return fixture.send(route, sends.length);
  });
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
  return {
    chat, sends, grantWrites,
    storedAccess: () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").permissionMode, PREFS_KEY),
    /** Someone else changes the grant (another window, Projects, the phone). */
    changeGrantElsewhere: (next: "read" | "write" | null) => { directAccess = next; },
    directAccess: () => directAccess,
  };
}

async function send(chat: ReturnType<Page["getByTestId"]>, text: string) {
  await chat.locator(".cave-composer-input").fill(text);
  await chat.getByRole("button", { name: "Send message" }).click();
}

test("Explore says it is read only, and one press switches this chat to Build", async ({ page }) => {
  const { chat, sends, storedAccess } = await setup(page, { access: "read", send: ok });
  const bar = chat.getByRole("region", { name: "Chat access" });
  await expect(bar).toContainText("Explore · read only");
  await expect(bar).toContainText("Nova can read files but can't change them.");
  // Keyboard activation: the pressed button is gone, so focus lands in the
  // composer rather than on the page. (A tap doesn't move focus; see #6445.)
  await bar.getByRole("button", { name: "Switch to Build" }).focus();
  await page.keyboard.press("Enter");
  await expect(bar).toHaveCount(0);
  await expect(chat.locator(".cave-composer-input")).toBeFocused();
  await send(chat, "Rename the helper.");
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].permissionMode).toBe("full");
  // Build applies to this chat; the shared composer default stays Explore.
  expect(await storedAccess()).toBe("read");
});

test("a ready Claude plan offers Build this plan", async ({ page }) => {
  const { chat, sends } = await setup(page, { access: "read", turns: [PLANNED], send: ok });
  const bar = chat.getByRole("region", { name: "Chat access" });
  await expect(bar).toContainText("Nova has a plan ready.");
  await bar.getByRole("button", { name: "Build this plan" }).click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].permissionMode).toBe("full");
  expect(String(sends[0].prompt)).toContain("plan");
  await expect(bar).toHaveCount(0);
});

test("a runtime that cannot apply Build explains why instead of offering it", async ({ page }) => {
  const reason = "Full access is unavailable for Claude on this runtime. Choose a runtime that can enforce project write access, then retry.";
  const { chat } = await setup(page, { access: "read", turns: [PLANNED], buildUnavailable: reason, send: ok });
  const bar = chat.getByRole("region", { name: "Chat access" });
  await expect(bar).toContainText("Explore · read only");
  await expect(bar).toContainText(reason);
  await expect(bar.getByRole("button", { name: "Switch to Build" })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Build this plan" })).toHaveCount(0);
});

test("a read-only project keeps the chat and offers write access with undo", async ({ page }) => {
  const { chat, sends, grantWrites } = await setup(page, {
    projectAccess: "read",
    send: (route, count) => count === 1
      ? route.fulfill({ status: 403, json: { ok: false, code: "project_write_access_required",
        error: "This project's access is read-only. Choose Read-only mode or request write access, then retry." } })
      : ok(route),
  });
  await send(chat, "Rename the helper.");
  await expect.poll(() => sends.length).toBe(1);
  // Read access was never revoked, so the transcript and the retry stay.
  await expect(chat.getByText("Ready for a message.")).toBeVisible();
  await expect(chat.getByText("Chat access changed.", { exact: false })).toHaveCount(0);
  const grant = chat.getByRole("button", { name: "Give Nova write access to Coven Cave and retry" });
  await expect(grant).toBeVisible();
  // Plain Retry would resend the refused Build turn; the two fixes replace it.
  await expect(chat.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  await grant.click();
  // Nothing changes until the person confirms the exact grant.
  expect(grantWrites).toEqual([]);
  await chat.getByRole("button", { name: "Confirm write access" }).click();
  await expect.poll(() => grantWrites.length).toBe(1);
  expect(grantWrites[0]).toEqual({ method: "POST", body: { targetFamiliarId: "nova", projectId: "p1", access: "write", expectedAccess: "read" } });
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1].prompt).toBe(sends[0].prompt);
  expect(sends[1].permissionMode).toBe("full");
  await chat.getByRole("button", { name: "Undo write access" }).click();
  await expect.poll(() => grantWrites.length).toBe(2);
  expect(grantWrites[1]).toEqual({ method: "POST", body: { targetFamiliarId: "nova", projectId: "p1", access: "read", expectedAccess: "write" } });
});

test("a read-only project can also retry the turn in Explore", async ({ page }) => {
  const { chat, sends, grantWrites } = await setup(page, {
    projectAccess: "read",
    send: (route, count) => count === 1
      ? route.fulfill({ status: 403, json: { ok: false, code: "project_write_access_required",
        error: "This project's access is read-only. Choose Read-only mode or request write access, then retry." } })
      : ok(route),
  });
  await send(chat, "Explain the helper.");
  await chat.getByRole("button", { name: "Use Explore and retry" }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1].prompt).toBe(sends[0].prompt);
  expect(sends[1].permissionMode).toBe("read");
  expect(grantWrites).toEqual([]);
});

test("Explore that the runtime cannot enforce offers Build and retry", async ({ page }) => {
  const { chat, sends } = await setup(page, {
    access: "read",
    send: (route, count) => count === 1
      ? route.fulfill({ status: 501, json: { ok: false, code: "read_only_unavailable",
        error: "This runtime cannot enforce Cave's Read-only mode. Switch Access to Full access or update the runtime before running it." } })
      : ok(route),
  });
  await send(chat, "Look at the helper.");
  await chat.getByRole("button", { name: "Use Build and retry" }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1].prompt).toBe(sends[0].prompt);
  expect(sends[1].permissionMode).toBe("full");
});

test("a runtime write-scope blocker offers Explore, never a Build that cannot run", async ({ page }) => {
  const { chat, sends } = await setup(page, {
    send: (route, count) => count === 1
      ? route.fulfill(stream([
        { kind: "error", code: "scoped_write_unavailable", harness: "claude",
          message: "Full access is unavailable for Claude on this runtime. Choose a runtime that can enforce project write access, then retry." },
        { kind: "done", sessionId: SESSION_ID, isError: true },
      ]))
      : ok(route),
  });
  await send(chat, "Rename the helper.");
  await expect(chat.getByText("Full access is unavailable for Claude on this runtime.", { exact: false })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Use Build and retry" })).toHaveCount(0);
  // Retry stays: after a runtime switch in the composer it is a working way out (#6419).
  await expect(chat.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await chat.getByRole("button", { name: "Use Explore and retry" }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1].prompt).toBe(sends[0].prompt);
  expect(sends[1].permissionMode).toBe("read");
});

test("the write-access grant works from the keyboard and keeps focus in the chat", async ({ page }) => {
  const { chat, sends, grantWrites } = await setup(page, {
    projectAccess: "read",
    send: (route, count) => count === 1
      ? route.fulfill({ status: 403, json: { ok: false, code: "project_write_access_required",
        error: "This project's access is read-only. Choose Read-only mode or request write access, then retry." } })
      : ok(route),
  });
  await send(chat, "Rename the helper.");
  const grant = chat.getByRole("button", { name: "Give Nova write access to Coven Cave and retry" });
  await grant.focus();
  await page.keyboard.press("Enter");
  const confirm = chat.getByRole("button", { name: "Confirm write access" });
  await expect(confirm).toBeFocused();
  await expect(grant).toHaveAttribute("aria-expanded", "true");
  // Escape backs out without a change and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(grant).toBeFocused();
  expect(grantWrites).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => grantWrites.length).toBe(1);
  await expect.poll(() => sends.length).toBe(2);
  const undo = chat.getByRole("button", { name: "Undo write access" });
  await expect(undo).toBeFocused();
  await expect(chat.getByRole("region", { name: "Chat access" }).getByRole("status")).toHaveText("Nova can now change files in Coven Cave.");
  await page.keyboard.press("Enter");
  await expect.poll(() => grantWrites.length).toBe(2);
  expect(grantWrites[1]).toEqual({ method: "POST", body: { targetFamiliarId: "nova", projectId: "p1", access: "read", expectedAccess: "write" } });
  await expect(undo).toHaveCount(0);
  await expect(chat.locator(".cave-composer-input")).toBeFocused();
});

test("an Undo made stale by another change is refused and says so", async ({ page }) => {
  const { chat, sends, grantWrites, changeGrantElsewhere, directAccess } = await setup(page, {
    projectAccess: "read",
    send: (route, count) => count === 1
      ? route.fulfill({ status: 403, json: { ok: false, code: "project_write_access_required",
        error: "This project's access is read-only. Choose Read-only mode or request write access, then retry." } })
      : ok(route),
  });
  await send(chat, "Rename the helper.");
  await chat.getByRole("button", { name: "Give Nova write access to Coven Cave and retry" }).click();
  await chat.getByRole("button", { name: "Confirm write access" }).click();
  await expect.poll(() => sends.length).toBe(2);
  const undo = chat.getByRole("button", { name: "Undo write access" });
  await expect(undo).toBeVisible();
  // The grant is lowered elsewhere before Undo; Undo must not overwrite that.
  changeGrantElsewhere("read");
  await undo.click();
  await expect.poll(() => grantWrites.length).toBe(2);
  expect(directAccess()).toBe("read");
  await expect(chat.getByText("Couldn't undo the access change:", { exact: false })).toBeVisible();
  await expect(chat.getByText("changed after it was shown", { exact: false })).toBeVisible();
  // Undo no longer applies, so it is withdrawn rather than left to fail again.
  await expect(undo).toHaveCount(0);
});
