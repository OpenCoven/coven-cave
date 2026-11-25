import { expect, test, type Page } from "@playwright/test";
import { completedFirstUsePayload } from "./fixtures/first-use";

// #6560: a chat refused because its project's folder was never confirmed
// (409 project_root_unconfirmed, #6215) offers Confirm folder in the error
// strip. It runs the settings confirmation (PUT /api/projects/<id>
// { confirmRoot: true }, the server's Touch ID prompt) for the project the
// server named, and retries the refused message only after a confirmed folder.
//
// Daemon-less (COVEN_CAVE_E2E=1): every API is a scoped page.route mock.

const ISO = "2026-11-22T15:00:00.000Z";
const SESSION_ID = "confirm-folder-chat";
const PROJECT = { id: "N94C2pFgDH", name: "Nova", root: "/home/cave/.coven/workspaces/familiars/nova", createdAt: ISO, updatedAt: ISO };
const UNCONFIRMED = {
  ok: false,
  code: "project_root_unconfirmed",
  projectId: PROJECT.id,
  error: "Confirm Nova’s folder in project settings before starting chat. Projects added before folder pinning need this once.",
};
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function setup(page: Page, options: {
  confirm?: { status: number; json: Record<string, unknown> };
  refusal?: Record<string, unknown>;
  /** Hold the Touch ID confirmation open until this resolves. */
  holdConfirm?: Promise<void>;
} = {}) {
  const sends: Array<Record<string, unknown>> = [];
  const confirms: Array<{ url: string; body: unknown }> = [];
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  const firstUse = completedFirstUsePayload({
    project: PROJECT, familiarIds: ["nova"], actingFamiliarId: "nova", permissionMode: "full", harness: "codex",
  });
  await page.route("**/api/onboarding/journey**", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 403, json: { ok: false } });
    const familiarId = new URL(route.request().url()).searchParams.get("runtimeFamiliarId");
    return route.fulfill({ json: familiarId
      ? { ok: true, runtime: { familiarId, harness: "codex", transport: "local", state: "ready" } }
      : { ok: true, ...firstUse } });
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "codex", icon: "ph:sparkle-fill" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{ id: SESSION_ID, title: "Confirm folder chat", status: "idle", project_root: PROJECT.root, harness: "codex", familiarId: "nova", model: null, runtime: `local:${PROJECT.root}`, exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO }],
  } }));
  // The registry listing and the confirm-folder PUT share this prefix.
  await page.route("**/api/projects**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      confirms.push({ url: new URL(request.url()).pathname, body: request.postDataJSON() });
      if (options.holdConfirm) await options.holdConfirm;
      const outcome = options.confirm ?? { status: 200, json: { ok: true, project: { ...PROJECT, rootRealpath: PROJECT.root } } };
      return route.fulfill({ status: outcome.status, json: outcome.json });
    }
    return route.fulfill({ json: { ok: true, projects: [{ ...PROJECT, access: "write" }] } });
  });
  await page.route("**/api/project-grants**", (route) => route.fulfill({ json: {
    ok: true, grants: [{ familiarId: "nova", projectId: PROJECT.id, access: "write", source: "human", grantedAt: ISO }],
    accessGroups: [], supremeFamiliarId: null, audit: [], grantChanges: [], privateStateProjectIds: [],
  } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true,
    conversation: { activeLeafId: "a1", turns: [{ id: "a1", parentId: null, role: "assistant", text: "Ready for a message.", createdAt: ISO }] },
  } }));
  await page.route("**/api/vault**", (route) => route.fulfill({ json: { ok: true, mappings: [] } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: {
    ok: true,
    state: { familiarId: "nova", runtime: null, harness: "codex", effectiveModel: null, source: "runtime-default", applicationState: "saved", reason: "e2e", familiarDefaultModel: null },
  } }));
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON() as Record<string, unknown>);
    if (sends.length === 1) return route.fulfill({ status: 409, json: options.refusal ?? UNCONFIRMED });
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        { kind: "assistant_chunk", text: "Folder confirmed, picking this up." },
        { kind: "done", sessionId: SESSION_ID, persistedTurnId: "after-confirm" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  return { sends, confirms };
}

async function sendRefused(page: Page) {
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
  await chat.locator(".cave-composer-input").fill("check in on coven-agents");
  await chat.getByRole("button", { name: "Send message" }).click();
  return chat;
}

test("Confirm folder confirms the refused project in place and retries the message", async ({ page }) => {
  const { sends, confirms } = await setup(page);
  const chat = await sendRefused(page);

  const strip = chat.getByRole("alert").filter({ hasText: "Confirm this project’s folder to continue." });
  await expect(strip).toBeVisible();
  await expect(strip).not.toContainText("in project settings");
  // The in-place action replaces the Projects detour for this refusal.
  await expect(strip.getByRole("button", { name: "Open projects" })).toHaveCount(0);
  const confirm = strip.getByRole("button", { name: "Confirm folder" });
  await expect(confirm).toBeVisible();
  // The strip wraps at phone width: every action, down to Dismiss, stays on screen.
  const viewport = page.viewportSize();
  for (const button of await strip.getByRole("button").all()) {
    const edge = await button.boundingBox();
    expect(edge && viewport && edge.x >= 0 && edge.x + edge.width <= viewport.width + 1, await button.innerText() || "Dismiss").toBe(true);
  }
  await confirm.click();

  await expect.poll(() => confirms).toEqual([{ url: `/api/projects/${PROJECT.id}`, body: { confirmRoot: true } }]);
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[0].prompt).toBe("check in on coven-agents");
  expect(sends[1].prompt).toBe(sends[0].prompt);
  await expect(chat.getByText("Folder confirmed, picking this up.")).toBeVisible();
  await expect(strip).toHaveCount(0);
});

test("A declined confirmation shows the server's words and never retries", async ({ page }) => {
  const declined = "Authenticate on this Mac to confirm the folder. Use Touch ID, then retry.";
  const { sends, confirms } = await setup(page, {
    confirm: { status: 403, json: { ok: false, code: "project_folder_authentication_required", error: declined } },
  });
  const chat = await sendRefused(page);

  await chat.getByRole("alert").getByRole("button", { name: "Confirm folder" }).click();
  const strip = chat.getByRole("alert").filter({ hasText: declined });
  await expect(strip).toBeVisible();
  expect(confirms).toHaveLength(1);
  expect(sends).toHaveLength(1);
  // The person can try the prompt again from the same place.
  await expect(strip.getByRole("button", { name: "Confirm folder" })).toBeEnabled();
});

test("A moved folder keeps the Projects route and offers no in-place confirmation", async ({ page }) => {
  const { confirms } = await setup(page, {
    refusal: { ok: false, code: "project_root_moved", error: "Nova’s folder now resolves somewhere else, so chat won’t start there." },
  });
  const chat = await sendRefused(page);

  const strip = chat.getByRole("alert").filter({ hasText: "This project’s folder now resolves somewhere else." });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole("button", { name: "Open projects" })).toBeVisible();
  await expect(strip.getByRole("button", { name: "Confirm folder" })).toHaveCount(0);
  expect(confirms).toHaveLength(0);
});

test("A message sent while Touch ID is open is not followed by a stale resend", async ({ page }) => {
  let release!: () => void;
  const holdConfirm = new Promise<void>((resolve) => { release = resolve; });
  const { sends, confirms } = await setup(page, { holdConfirm });
  const chat = await sendRefused(page);

  await chat.getByRole("alert").getByRole("button", { name: "Confirm folder" }).click();
  await expect.poll(() => confirms.length).toBe(1);
  // The person moves on before approving the prompt.
  await chat.locator(".cave-composer-input").fill("a newer message");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sends.length).toBe(2);
  release();

  await expect(chat.getByText("Folder confirmed, picking this up.")).toBeVisible();
  // Give a stale retry every chance to fire, then prove it never did.
  await page.waitForTimeout(500);
  expect(sends).toHaveLength(2);
  expect(sends[1].prompt).toBe("a newer message");
});

// ── Board: the task-chat banner offers the same in-place confirmation. ──────
const TASK = {
  id: "card-folder", title: "Track remaining Psyche blockers", notes: "", status: "backlog", priority: "high",
  familiarId: "nova", sessionId: null, cwd: PROJECT.root, projectId: null, links: [], github: [], asana: [], labels: [],
  createdAt: ISO, updatedAt: ISO, lifecycle: "queued", lifecycleAt: ISO, retryCount: 0, maxRetries: 3, steps: [],
};

const OTHER_PROJECT = { ...PROJECT, id: "other-project", name: "Other", root: "/tmp/other-board-project" };
const OTHER_TASK = { ...TASK, id: "other-card", title: "Inspect the other runtime", cwd: OTHER_PROJECT.root, projectId: OTHER_PROJECT.id };
const OTHER_ERROR = "The other task's runtime is unavailable.";

async function setupBoard(page: Page, confirm: { status: number; json: Record<string, unknown>; hold?: Promise<void> }) {
  const starts: { path: string; projectRoot?: string }[] = [];
  const cards = confirm.hold ? [{ ...TASK, projectId: PROJECT.id }, OTHER_TASK] : [TASK];
  const confirms: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:code-rail:pinned:v1", "false");
  });
  // Starting a task chat first checks the first-use journey; mark it done.
  const firstUse = completedFirstUsePayload({
    project: PROJECT, familiarIds: ["nova"], actingFamiliarId: "nova", permissionMode: "full", harness: "codex",
  });
  await page.route("**/api/onboarding/journey**", (route) => {
    const familiarId = new URL(route.request().url()).searchParams.get("runtimeFamiliarId");
    return route.fulfill({ json: familiarId
      ? { ok: true, runtime: { familiarId, harness: "codex", transport: "local", state: "ready" } }
      : { ok: true, ...firstUse } });
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/projects**", async (route) => {
    if (route.request().method() === "PUT") {
      confirms.push(new URL(route.request().url()).pathname);
      await confirm.hold;
      return route.fulfill({ status: confirm.status, json: confirm.json });
    }
    return route.fulfill({ json: { ok: true, projects: [PROJECT, OTHER_PROJECT].map(project => ({ ...project, access: "write" })) } });
  });
  await page.route("**/api/board", (route) => route.fulfill({ json: { ok: true, cards } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: { ok: true, conversation: { turns: [] }, context: {} } }));
  await page.route("**/api/chat/send**", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/board/*/chat", (route) => {
    const path = new URL(route.request().url()).pathname;
    starts.push({ path, projectRoot: route.request().postDataJSON().projectRoot });
    if (path === `/api/board/${OTHER_TASK.id}/chat`) {
      return route.fulfill({ status: 409, json: { ok: false, error: OTHER_ERROR } });
    }
    if (starts.length === 1) return route.fulfill({ status: 409, json: UNCONFIRMED });
    return route.fulfill({ json: {
      ok: true, sessionId: "s-task", familiarId: "nova", bridge: "native-chat",
      initialPrompt: "Track remaining Psyche blockers.", card: { ...TASK, sessionId: "s-task" },
    } });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/?mode=board#card-${TASK.id}`);
  await page.waitForSelector(".board-drawer-field", { timeout: 45_000 });
  await page.locator(".board-drawer-chat-cta").first().click();
  // The board banner sits behind the modal drawer, so the drawer offers it.
  const banner = page.getByRole("dialog", { name: "Card inspector" });
  await expect(banner.getByText("Confirm Nova’s folder to continue.")).toBeVisible();
  await expect(banner).not.toContainText("in project settings");
  return { starts, confirms, banner };
}

test("Board: Confirm folder confirms the task's project and starts its chat once", async ({ page }) => {
  const { starts, confirms, banner } = await setupBoard(page, {
    status: 200, json: { ok: true, project: { ...PROJECT, rootRealpath: PROJECT.root } },
  });
  await banner.getByRole("button", { name: "Confirm folder" }).click();

  await expect.poll(() => confirms).toEqual([`/api/projects/${PROJECT.id}`]);
  await expect.poll(() => starts.length).toBe(2);
  await page.waitForSelector(".task-work-cockpit", { timeout: 30_000 });
  await page.waitForTimeout(500);
  expect(starts).toHaveLength(2);
});

test("Board: a declined confirmation never restarts the task chat", async ({ page }) => {
  const declined = "Authenticate on this Mac to confirm the folder. Use Touch ID, then retry.";
  const { starts, confirms, banner } = await setupBoard(page, {
    status: 403, json: { ok: false, code: "project_folder_authentication_required", error: declined },
  });
  await banner.getByRole("button", { name: "Confirm folder" }).click();

  await expect(banner.getByText(declined)).toBeVisible();
  await expect(banner.getByRole("button", { name: "Confirm folder" })).toBeEnabled();
  expect(confirms).toHaveLength(1);
  expect(starts).toHaveLength(1);
});

for (const surface of ["banner", "drawer"]) {
  for (const outcome of ["success", "decline"]) {
    test(`Board preserves a newer task's error after a late ${outcome} from the ${surface}`, async ({ page }) => {
      let finishConfirmation!: () => void;
      const hold = new Promise<void>((resolve) => { finishConfirmation = resolve; });
      const result = outcome === "success"
        ? { status: 200, json: { ok: true, project: { ...PROJECT, rootRealpath: PROJECT.root } } }
        : { status: 403, json: { ok: false, error: "Folder confirmation declined." } };
      const { starts, confirms, banner: drawer } = await setupBoard(page, { ...result, hold });
      const board = page.locator(".board-shell");
      const closeDrawer = () => drawer.getByLabel("Close", { exact: true }).click();
      try {
        if (surface === "banner") await closeDrawer();
        const origin = surface === "drawer" ? drawer : board.getByRole("alert");
        await origin.getByRole("button", { name: "Confirm folder", exact: true }).click();
        await expect.poll(() => confirms.length).toBe(1);
        if (surface === "drawer") await closeDrawer();
        await board.locator(`[data-card-id="${OTHER_TASK.id}"]`).getByTitle("Start work").click();
        const error = board.getByRole("alert");
        await expect(error).toContainText(OTHER_ERROR);

        const response = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith(`/api/projects/${PROJECT.id}`));
        finishConfirmation();
        await (await response).finished();
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

        await expect(error).toContainText(OTHER_ERROR);
        await expect(error.getByRole("button", { name: "Confirm folder" })).toHaveCount(0);
        expect(starts).toEqual([
          { path: `/api/board/${TASK.id}/chat`, projectRoot: PROJECT.root },
          { path: `/api/board/${OTHER_TASK.id}/chat`, projectRoot: OTHER_PROJECT.root },
        ]);
        expect(confirms).toEqual([`/api/projects/${PROJECT.id}`]);
      } finally {
        finishConfirmation();
      }
    });
  }
}
