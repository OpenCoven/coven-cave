import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { advanceFirstUse, createFirstUseState, createQuickStartState, type FirstUseState } from "../src/lib/first-use";
import { openChatFilter } from "./fixtures/chat-filter";
import { chatComposerDraftKey } from "../src/lib/use-composer-draft";

test.use({ serviceWorkers: "block" });
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(JSON.stringify({ name: error.name, message: error.message, stack: error.stack, text: String(error) })));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/_next/")) errors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const target = info.outputPath("browser-runtime-errors.json");
    await writeFile(target, JSON.stringify(browserErrors.get(page) ?? [], null, 2));
    await info.attach("browser-runtime-errors", { path: target, contentType: "application/json" });
  }
});
const PROJECT = { id: "first-project", name: "Practice garden", root: "/synthetic/garden", createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z", access: "read" };
const FAMILIARS = [{ id: "nova", display_name: "Nova", role: "Planner", harness: "codex", status: "active" }];

async function fixture(page: Page, initial: FirstUseState = createQuickStartState()) {
  // Installation dismissal is separate from the host-owned methodology journey.
  const host = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1").hostname;
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: host, path: "/" }]);
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { ok: false, error: "Outside the isolated first-use fixture" } }));
  let state = initial;
  let revoked = false;
  let revokedMember: string | null = null;
  let runtime = true;
  let accessLevel: "read" | "write" = "read";
  const sends: unknown[] = [];
  const actions: unknown[] = [];
  await page.addInitScript(() => { localStorage.setItem("cave:onboarding:dismissed", "1"); });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: FAMILIARS.map((f) => ({ ...f, projectAccess: revoked ? null : accessLevel })) } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [{ ...PROJECT, access: revoked ? null : accessLevel }] } }));
  await page.route("**/api/project-grants**", (route) => {
    if (route.request().method() === "POST") { const body = route.request().postDataJSON(); accessLevel = body.access; revoked = false; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { ok: true, grants: revoked ? [] : [{ familiarId: "nova", projectId: PROJECT.id, access: accessLevel }], accessGroups: [], supremeFamiliarId: null } });
  });
  await page.route("**/api/project-tree?**", (route) => route.fulfill({ json: { ok: true, entries: [{ name: "README.md", path: `${PROJECT.root}/README.md`, isDir: false }] } }));
  await page.route("**/api/project-file?**", (route) => route.fulfill({ json: { ok: true, kind: "text", content: "# Practice garden\nA synthetic project for reviewing onboarding." } }));
  await page.route("**/api/harnesses**", (route) => route.fulfill({ json: { ok: true, harnesses: [{ id: "codex", label: "Codex", installed: runtime, chatSupported: true }] } }));
  await page.route("**/api/onboarding/journey?runtimeFamiliarId=*", (route) => route.fulfill({ json: { ok: true, runtime: { familiarId: new URL(route.request().url()).searchParams.get("runtimeFamiliarId"), harness: "codex", transport: "local", state: runtime ? "ready" : "unavailable" } } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: { ok: true, state: { familiarId: "nova", runtime: null, harness: "codex", effectiveModel: "unknown", source: "runtime-default", applicationState: "saved", reason: "Synthetic runtime" } } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/daemon/status**", (route) => route.fulfill({ json: { ok: true, running: true, connected: true, availability: "online", targetMode: "local", target: { mode: "local" } } }));
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route("**/api/onboarding/journey", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.revision !== state.revision) return route.fulfill({ status: 409, json: { ok: false, code: "first_use_changed", error: "The introduction changed in another window. Reload it before continuing." } });
      actions.push(body.action);
      state = advanceFirstUse(state, body.action);
    }
    const resolution = !state.defaults || revoked || revokedMember
      ? { kind: "repair", context: state.defaults, reason: revoked || revokedMember ? "access" : "missing", message: revoked || revokedMember ? "A saved familiar no longer has project access. Review access or choose another scope." : "Choose a default project and familiar scope to start new work." }
      : { kind: "ready", context: state.defaults };
    return route.fulfill({ json: { ok: true, state, resolution, project: state.defaults ? PROJECT : null, access: state.defaults ? state.defaults.familiarIds.map((familiarId) => ({ familiarId, level: revoked || familiarId === revokedMember ? null : familiarId === "nova" ? accessLevel : "read", direct: revoked || familiarId === revokedMember ? null : familiarId === "nova" ? accessLevel : "read", groups: [], supreme: false })) : [], starterRoot: "/synthetic/cave-starter" } });
  });
  await page.route("**/api/chat/send", (route) => { sends.push(route.request().postDataJSON()); return route.fulfill({ contentType: "text/event-stream", body: 'data: {"kind":"done","sessionId":"practice-real-chat"}\n\n' }); });
  return { getState: () => state, actions, sends, revoke: () => { revoked = true; }, revokeMember: (id: string) => { revokedMember = id; }, restore: () => { revoked = false; }, disableRuntime: () => { runtime = false; }, allowWrite: () => { accessLevel = "write"; }, changeInOtherWindow: () => { state = { ...state, revision: state.revision + 1 }; } };
}

test("short onboarding resumes and opens an editable real-chat draft without automatic dispatch", async ({ page }, testInfo) => {
  const f = await fixture(page);
  await page.goto("/?mode=home");
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await expect(guide).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("assistant-desktop.png") });
  await guide.getByRole("button", { name: /^Nova/ }).click();
  await guide.getByRole("button", { name: "Choose a project", exact: true }).click();
  await guide.getByRole("button", { name: "Explore first", exact: true }).click();
  expect(f.getState().step).toBe("project");
  await page.reload();
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await guide.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("menuitemradio", { name: `${PROJECT.name} ${PROJECT.root}`, exact: true }).click();
  await guide.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(guide).toContainText("A synthetic project for reviewing onboarding");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("project-desktop.png") });
  await guide.getByRole("radio", { name: /^Read Explore files/ }).check();
  await guide.getByRole("button", { name: "Continue with Read", exact: true }).click();
  await expect(guide).toContainText("Your first request");
  expect(f.getState().practice.verified).toBe(false);
  expect(f.getState().step).toBe("complete");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("first-request-desktop.png") });
  expect(f.sends).toEqual([]);
  await guide.getByRole("button", { name: "Open in Chat", exact: true }).click();
  await expect(guide).toBeHidden();
  const chat = page.getByTestId("chat-main");
  const input = chat.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toHaveValue("Summarize this project and suggest one useful next step. Do not change files.");
  expect(f.sends).toEqual([]);
  await expect(chat.getByRole("button", { name: /Map this project/ })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("real-chat-desktop.png") });
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("first-chat.png") });
  await input.fill("Explain this project’s entry point");
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]).toMatchObject({ familiarId: "nova", projectRoot: PROJECT.root, permissionMode: "read" });
});

test("a missing runtime installs in the assistant chooser only after explicit action", async ({ page }) => {
  const f = await fixture(page);
  let started = false, complete = false, installed = false;
  const installs: unknown[] = [];
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/harnesses**", (route) => route.fulfill({ json: { ok: true, harnesses: [{ id: "codex", label: "Codex", installed, chatSupported: true }] } }));
  await page.route("**/api/onboarding/install**", (route) => {
    if (route.request().method() === "POST") { installs.push(route.request().postDataJSON()); started = true; return route.fulfill({ status: 202, json: { status: "started" } }); }
    const target = new URL(route.request().url()).searchParams.get("target");
    if (!target) return route.fulfill({ json: { status: "idle", npmBusy: started && !complete, npmBusyLabel: "Codex" } });
    if (target === "codex" && started) { installed = complete; return route.fulfill({ json: complete ? { status: "done", ok: true } : { status: "running" } }); }
    return route.fulfill({ json: { status: "idle" } });
  });
  await page.goto("/?mode=home");
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await expect(guide.getByRole("button", { name: "Install Codex", exact: true })).toBeEnabled();
  expect(installs).toEqual([]);
  await guide.getByRole("button", { name: "Install Codex", exact: true }).click();
  await expect.poll(() => installs.length).toBe(1);
  expect(installs[0]).toEqual({ target: "codex", confirmInstall: true });
  await expect(guide.getByRole("button", { name: "Installing Codex…", exact: true })).toBeDisabled();
  complete = true;
  await expect(guide.getByRole("button", { name: "Create with Codex", exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect(guide).toContainText("Sign in if requested when you first send a message.");
  expect(f.sends).toEqual([]);
});

test("short setup retains the first failed request for Retry and Stop reaches cancellation", async ({ page }) => {
  const selected = advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" });
  const state = advanceFirstUse(selected, { kind: "finish-setup", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, permissionMode: "read" });
  await fixture(page, state);
  await page.route("**/api/chat/send", (route) => route.fulfill({ status: 503, json: { ok: false, error: "Synthetic first-send failure" } }));
  await page.goto("/?mode=home");
  await expect(page.getByRole("complementary", { name: "Getting started", exact: true })).toContainText("Your workspace is ready.");
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await page.getByRole("dialog", { name: "Get started with Cave" }).getByRole("button", { name: "Open in Chat", exact: true }).click();
  const chat = page.getByTestId("chat-main");
  const input = chat.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("Keep this first request after a failed send");
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(chat.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  let started = false, stopped = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/chat/stop", (route) => { stopped++; return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/chat/send", async (route) => { started = true; await held; await route.fulfill({ contentType: "text/event-stream", body: 'data: {"kind":"done"}\n\n' }).catch(() => {}); });
  await chat.getByRole("button", { name: "Retry", exact: true }).click();
  try {
    await expect.poll(() => started).toBe(true);
    await chat.getByRole("button", { name: "Cancel response", exact: true }).click();
    await expect.poll(() => stopped).toBe(1);
  } finally { release(); }
});

test("Full requires an explicit choice and opens Chat with the reviewed mode", async ({ page }) => {
  const state = { ...advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" }), defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" } };
  const f = await fixture(page, state);
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  const full = guide.getByRole("radio", { name: /^Full Read, create/ });
  await expect(full).not.toBeChecked();
  await full.check();
  await guide.getByRole("button", { name: "Allow Full and continue", exact: true }).click();
  await expect.poll(() => f.getState().step).toBe("complete");
  expect(f.getState().permissionMode).toBe("full");
  await guide.getByRole("button", { name: "Open in Chat", exact: true }).click();
  await expect(page.getByTestId("chat-main").getByRole("button", { name: /Project: Practice garden.*Full/ })).toBeVisible();
  expect(f.sends).toEqual([]);
});

test("reopened Read setup overrides a conflicting Full preference only for the new chat", async ({ page }) => {
  const selected = advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" });
  const state = advanceFirstUse(selected, { kind: "finish-setup", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, permissionMode: "read" });
  const f = await fixture(page, state); f.allowWrite();
  await page.addInitScript(() => localStorage.setItem("cave:chat-composer-controls:v1", JSON.stringify({ permissionMode: "full" })));
  await page.goto("/?mode=home");
  await expect(page.getByRole("complementary", { name: "Getting started", exact: true })).toContainText("Your workspace is ready.");
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await expect(guide).toContainText("Read only");
  await guide.getByRole("button", { name: "Open in Chat", exact: true }).click();
  const chat = page.getByTestId("chat-main");
  await expect(chat.getByRole("button", { name: /Project: Practice garden.*Full/ })).toBeVisible();
  await expect(chat.locator("[data-access-mode]")).toHaveAttribute("data-access-mode", "read");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:chat-composer-controls:v1")!).permissionMode)).toBe("full");
  await chat.getByRole("textbox", { name: "Message", exact: true }).fill("Explain the entry point without changing files");
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]).toMatchObject({ permissionMode: "read" });
});

for (const destination of ["project", "session"] as const) {
  test(`an unresolved starter replacement cannot overwrite another ${destination} draft`, async ({ page }) => {
    const selected = advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" });
    const state = advanceFirstUse(selected, { kind: "finish-setup", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, permissionMode: "read" });
    await fixture(page, state);
    const other = { ...PROJECT, id: "other-project", name: "Other project", root: "/synthetic/other" };
    const session = { id: "starter-bound", title: "Existing other chat", familiarId: "nova", project_root: other.root, harness: "codex", status: "completed", hasLocalConversation: true, created_at: "2026-11-11T00:00:00.000Z", updated_at: "2026-11-11T00:00:00.000Z" };
    await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [PROJECT, other] } }));
    await page.route("**/api/project-grants**", (route) => route.fulfill({ json: { ok: true, grants: [PROJECT, other].map((project) => ({ familiarId: "nova", projectId: project.id, access: "read" })), accessGroups: [], supremeFamiliarId: null } }));
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [session] } }));
    await page.route("**/api/chat/conversation/starter-bound**", (route) => route.fulfill({ json: { ok: true, conversation: { sessionId: session.id, familiarId: "nova", harness: "codex", turns: [], createdAt: session.created_at, updatedAt: session.updated_at }, context: null } }));
    const key = (project: string, sessionId: string | null = null) => chatComposerDraftKey("cave:chat-composer-draft:v1", { familiarId: "nova", sessionId, project, host: "local" });
    await page.addInitScript((drafts) => { for (const [key, text] of drafts) localStorage.setItem(key, text); }, [[key(PROJECT.root), "Original project A draft"], [key(other.root), "Original project B draft"], [key(other.root, session.id), "Original session B draft"]]);
    await page.goto("/?mode=home");
    await expect(page.getByRole("complementary", { name: "Getting started", exact: true })).toContainText("Your workspace is ready.");
    await page.getByRole("button", { name: "Continue setup", exact: true }).click();
    await page.getByRole("dialog", { name: "Get started with Cave" }).getByRole("button", { name: "Open in Chat", exact: true }).click();
    const chat = page.getByTestId("chat-main");
    await expect(chat.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Original project A draft");
    await expect(chat.getByRole("button", { name: "Use starter request", exact: true })).toBeVisible();
    if (destination === "project") {
      await chat.getByRole("button", { name: /Project: Practice garden.*change project/ }).click();
      await page.getByRole("menuitemradio", { name: /^Other project Read/ }).click();
    } else {
      await page.evaluate((sessionId) => window.dispatchEvent(new CustomEvent("cave:agents-open-session", { detail: { sessionId, familiarId: "nova" } })), session.id);
    }
    await expect(chat.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(destination === "project" ? "Original project B draft" : "Original session B draft");
    await expect(chat.getByRole("button", { name: "Use starter request", exact: true })).toHaveCount(0);
  });
}

test("a saved default is restored into the shared Chat workspace selection", async ({ page }) => {
  const state: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  await fixture(page, state);
  await page.goto("/?mode=chat");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cave:workspace:project-scope:v1"))).toBe(JSON.stringify(PROJECT.id));
  const filter = await openChatFilter(page);
  await expect(filter.controls.getByRole("button", { name: /^Switch project: Practice garden/ })).toBeVisible();
  await expect(filter.controls.getByRole("button", { name: "Switch familiar — current: Nova", exact: true })).toBeVisible();
  await filter.close();
});

test("revoked defaults require repair and preserve their stable identities", async ({ page }) => {
  const state: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, state);
  f.revoke();
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Review default context", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Get started with Cave" })).toContainText("no longer has project access");
  expect(f.getState().defaults?.familiarIds).toEqual(["nova"]);
  expect(f.sends).toEqual([]);
});

test("opening the guide at Home send preserves the draft and attachments", async ({ page }) => {
  const f = await fixture(page, advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }));
  await page.addInitScript(() => {
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("first-project"));
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "first-project": ["nova"] }));
  });
  await page.goto("/?mode=home");
  const home = page.locator(".home-composer-root");
  await home.getByRole("textbox", { name: "Chat message" }).fill("Keep this outcome and its evidence");
  await home.locator('input[type="file"]').setInputFiles({ name: "evidence.txt", mimeType: "text/plain", buffer: Buffer.from("Acceptance evidence") });
  await expect(home).toContainText("evidence.txt");
  await home.getByRole("button", { name: "Send message", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await expect(guide).toBeVisible();
  expect(f.sends).toEqual([]);
  await guide.getByRole("button", { name: "Explore first", exact: true }).click();
  await expect(home.getByRole("textbox", { name: "Chat message" })).toHaveValue("Keep this outcome and its evidence");
  await expect(home).toContainText("evidence.txt");
});

test("an unavailable runtime has a repair action and cannot finish default configuration", async ({ page }) => {
  let state = advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" });
  state = { ...state, defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" } };
  const f = await fixture(page, state); f.disableRuntime();
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await guide.getByRole("radio", { name: /^Read Explore files/ }).check();
  await expect(guide).toContainText("runtime is unavailable");
  await expect(guide.getByRole("button", { name: "Open setup", exact: true })).toBeVisible();
  await expect(guide.getByRole("button", { name: "Continue with Read", exact: true })).toBeDisabled();
  expect(f.getState().completedAt).toBeNull();
});

test("Tasks opens the introduction before a task launch can mutate or execute", async ({ page }) => {
  const f = await fixture(page, advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }));
  const card = { id: "first-task", title: "Plan the garden", notes: "", status: "running", priority: "high", familiarId: "nova", sessionId: null, projectId: PROJECT.id, cwd: PROJECT.root, links: [], github: [], asana: [], labels: [], steps: [], lifecycle: "running", lifecycleAt: "2026-11-11T00:00:00.000Z", retryCount: 0, maxRetries: 3, createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z", dependencies: [] };
  let launches = 0;
  await page.route("**/api/board", (route) => route.fulfill({ json: { ok: true, cards: [card] } }));
  await page.route("**/api/board/first-task/chat", (route) => { launches++; return route.fulfill({ status: 409, json: { ok: false, error: "Fixture must not launch" } }); });
  await page.goto("/?mode=board#card-first-task");
  await page.locator(".board-drawer-chat-cta").first().click();
  await expect(page.getByRole("dialog", { name: "Get started with Cave" })).toBeVisible();
  expect(launches).toBe(0);
  expect(f.sends).toEqual([]);
});

test("the guide contains keyboard focus and fits narrow light and alternate-theme layouts", async ({ page }, testInfo) => {
  await fixture(page, advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/?mode=home");
  const trigger = page.getByRole("button", { name: "Continue setup", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await expect(guide).toBeVisible();
  await expect.poll(() => guide.evaluate((element) => element.contains(document.activeElement)), { message: "Opening setup moves focus into the guide" }).toBe(true);
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label") }));
    await expect.poll(() => guide.evaluate((element) => element.contains(document.activeElement)), { message: `Tab ${index}: ${JSON.stringify(active)}` }).toBe(true);
  }
  for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
    await page.evaluate(([theme, mode]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, [theme, mode]);
    expect(await guide.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`guide-narrow-${theme}-${mode}.png`) });
  }
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const entry of ["live", "persisted-panel", "persisted-missing-project"] as const) {
  test(`${entry} launch keeps its prompt and explicit context while the introduction is unfinished`, async ({ page }) => {
    const f = await fixture(page, advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }));
    const request = { familiarId: "nova", projectRoot: entry === "persisted-missing-project" ? "/synthetic/deleted" : PROJECT.root, initialPrompt: "Keep this explicit launch brief", ...(entry === "persisted-panel" ? { destination: "right-panel" } : {}) };
    await page.addInitScript(({ entry, request }) => {
      localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("first-project"));
      localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "first-project": ["nova"] }));
      if (entry !== "live") sessionStorage.setItem("cave:pending-agents-new-chat", JSON.stringify(request));
    }, { entry, request });
    await page.goto("/?mode=home");
    await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toBeVisible();
    if (entry === "live") {
      // Live UI events require a hydrated listener; pre-hydration handoffs use the persisted cases above.
      await expect(page.getByRole("complementary", { name: "Getting started", exact: true })).toContainText("Choose an assistant, project and access. Your progress is kept.");
      await page.evaluate((request) => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", { detail: request })), request);
    }
    await expect(page.getByRole("dialog", { name: "Get started with Cave" })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("cave:pending-agents-new-chat") ?? "null"))).toMatchObject(request);
    expect(f.sends).toEqual([]);
  });
}

test("a removed familiar stays visible for explicit scope repair before choosing a replacement", async ({ page }) => {
  const state: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, state); f.revoke();
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [{ id: "sage", display_name: "Sage", role: "Planner", harness: "codex", projectAccess: "read" }] } }));
  await page.route("**/api/project-grants**", (route) => route.fulfill({ json: { ok: true, grants: [{ familiarId: "sage", projectId: PROJECT.id, access: "read" }], accessGroups: [], supremeFamiliarId: null } }));
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Review default context", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await guide.getByText("Familiar scope and defaults", { exact: true }).click();
  const removed = guide.getByRole("checkbox", { name: /Unavailable familiar nova/ });
  await expect(removed).toBeChecked(); expect(f.getState().defaults?.familiarIds).toEqual(["nova"]);
  await guide.getByRole("button", { name: "Back to assistants", exact: true }).click();
  await guide.getByRole("button", { name: /Meet the others/ }).click();
  await guide.getByRole("button", { name: /^Sage/ }).click();
  await guide.getByRole("button", { name: "Choose a project", exact: true }).click();
  await guide.getByText("Familiar scope and defaults", { exact: true }).click();
  await removed.click();
  await expect(removed).toHaveCount(0); f.restore();
  await guide.getByRole("radio", { name: /^Read Explore files/ }).check();
  await guide.getByRole("button", { name: "Continue with Read", exact: true }).click();
  expect(f.getState().defaults).toEqual({ projectId: PROJECT.id, familiarIds: ["sage"], actingFamiliarId: "sage" });
});

test("a stale context form offers an explicit reload before it can save the current revision", async ({ page }) => {
  const state: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, state);
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await guide.getByRole("button", { name: "Change", exact: true }).click();
  await guide.getByRole("radio", { name: /^Read Explore files/ }).check();
  f.changeInOtherWindow();
  await guide.getByRole("button", { name: "Continue with Read", exact: true }).click();
  await expect(guide).toContainText("changed in another window");
  await guide.getByRole("button", { name: "Reload saved context", exact: true }).click();
  await guide.getByRole("button", { name: "Change", exact: true }).click();
  await guide.getByRole("radio", { name: /^Read Explore files/ }).check();
  await guide.getByRole("button", { name: "Continue with Read", exact: true }).click();
  await expect.poll(() => f.getState().revision).toBe(11);
});

test("changing from a Write actor to a Read actor requires a new access choice", async ({ page }) => {
  const state = { ...advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" }), defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" } };
  const f = await fixture(page, state); f.allowWrite();
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [...FAMILIARS, { id: "sage", display_name: "Sage", role: "Planner", harness: "codex", projectAccess: "read" }] } }));
  await page.route("**/api/project-grants**", (route) => route.fulfill({ json: { ok: true, grants: [{ familiarId: "nova", projectId: PROJECT.id, access: "write" }, { familiarId: "sage", projectId: PROJECT.id, access: "read" }], accessGroups: [], supremeFamiliarId: null } }));
  await page.goto("/?mode=home"); await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await guide.getByRole("radio", { name: /^Full Read, create/ }).check();
  await guide.getByRole("button", { name: "Back to assistants", exact: true }).click();
  await guide.getByRole("button", { name: /Meet the others/ }).click();
  await guide.getByRole("button", { name: /^Sage/ }).click();
  await guide.getByRole("button", { name: "Choose a project", exact: true }).click();
  await expect(guide.getByRole("radio", { name: /^Full Read, create/ })).not.toBeChecked();
  await expect(guide.getByRole("button", { name: "Continue with Read", exact: true })).toBeDisabled();
  await guide.getByRole("radio", { name: /^Read Explore files/ }).check();
  await guide.getByRole("button", { name: "Continue with Read", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:chat-composer-controls:v1") ?? "{}").permissionMode)).toBe("read");
});

for (const presentation of ["tray"] as const) {
  test(`${presentation} restores concrete defaults and keeps its draft when introduction needs the main window`, async ({ page }) => {
    const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
    const f = await fixture(page, initial);
    await page.addInitScript(() => { localStorage.setItem("cave.quick-chat.last-familiar", "old-actor"); localStorage.setItem("cave:chat-composer-controls:v1", JSON.stringify({ permissionMode: "read" })); });
    await page.goto("/quick-chat");
    const pane = page.getByRole("tabpanel");
    await expect(pane).toContainText(PROJECT.name);
    const input = pane.getByRole("combobox", { name: "Message", exact: true });
    await input.fill("Use the saved project and actor");
    await input.press("Enter");
    await expect.poll(() => f.sends.length).toBe(1);
    expect(f.sends[0]).toMatchObject({ familiarId: "nova", projectRoot: PROJECT.root, permissionMode: "read", prompt: "Use the saved project and actor" });
  });

  test(`${presentation} keeps an unfinished draft and offers an introduction handoff without execution`, async ({ page }) => {
    const initial = advanceFirstUse(advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }), { kind: "context", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" } });
    const f = await fixture(page, initial);
    await page.goto("/quick-chat");
    const pane = page.getByRole("tabpanel");
    await expect(pane).toContainText(PROJECT.name);
    const input = pane.getByRole("combobox", { name: "Message", exact: true });
    await input.fill("Keep this compact chat brief");
    await expect(input).toHaveValue("Keep this compact chat brief");
    await input.press("Enter");
    await expect(pane.getByRole("button", { name: "Continue introduction in Cave", exact: true })).toBeVisible();
    await expect(input).toHaveValue("Keep this compact chat brief");
    const popupEvent = page.context().waitForEvent("page");
    await pane.getByRole("button", { name: "Continue introduction in Cave", exact: true }).click();
    const popup = await popupEvent;
    await expect.poll(() => popup.url()).toContain("firstUse=1");
    await popup.close();
    await expect(input).toHaveValue("Keep this compact chat brief");
    expect(f.sends).toEqual([]);
  });
}

for (const destination of ["main", "right-panel"] as const) {
test(`${destination} keeps an unavailable explicit launch for review and explicit retargeting after introduction`, async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  const request = { familiarId: "nova", projectRoot: "/synthetic/deleted", initialPrompt: "Retain this exact brief", destination };
  await page.addInitScript((request) => sessionStorage.setItem("cave:pending-agents-new-chat", JSON.stringify(request)), request);
  await page.goto("/?mode=home");
  const repair = page.getByRole("region", { name: "Pending chat needs review", exact: true });
  await expect(repair).toContainText("no longer available");
  await expect(repair).toContainText(request.initialPrompt);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("cave:pending-agents-new-chat") ?? "null"))).toMatchObject(request);
  expect(f.sends).toEqual([]);
  await repair.getByRole("button", { name: "Use saved default context for this brief", exact: true }).click();
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]).toMatchObject({ familiarId: "nova", projectRoot: PROJECT.root, prompt: request.initialPrompt });
});
}

test("Enhance prompt and Enhance tasks open the introduction without calling a model", async ({ page }) => {
  const f = await fixture(page, advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }));
  let enrichRequests = 0;
  await page.route("**/api/board/enrich-steps", (route) => { enrichRequests++; return route.fulfill({ status: 409, json: { ok: false, error: "Must not execute" } }); });
  await page.addInitScript(() => {
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("first-project"));
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "first-project": ["nova"] }));
  });
  await page.goto("/?mode=home");
  const home = page.locator(".home-composer-root");
  const input = home.getByRole("textbox", { name: "Chat message", exact: true });
  await input.fill("Keep my original outcome");
  await home.getByRole("button", { name: "Composer actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Enhance prompt", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Explore first", exact: true }).click();
  await expect(input).toHaveValue("Keep my original outcome");
  expect(f.sends).toEqual([]);
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await page.getByRole("button", { name: /Enhance every open task/ }).click();
    await expect(guide).toBeVisible();
  }
  expect(enrichRequests).toBe(0);
});

test("voice waits for the introduction before microphone access or conversation creation", async ({ page }) => {
  const f = await fixture(page, advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }));
  let mints = 0;
  await page.route("**/api/chat/conversation", (route) => { mints++; return route.fulfill({ status: 409, json: { ok: false, error: "Must not mint" } }); });
  await page.addInitScript(() => {
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("first-project"));
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "first-project": ["nova"] }));
    Object.assign(window, { __microphoneRequests: 0 });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { (window as unknown as { __microphoneRequests: number }).__microphoneRequests++; return new MediaStream(); } } });
  });
  const mobile = (page.viewportSize()?.width ?? 0) < 768;
  if (mobile) {
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [{ id: "voice-bound", title: "Voice context", familiarId: "nova", project_root: PROJECT.root, harness: "codex", status: "completed", hasLocalConversation: true, created_at: "2026-11-11T00:00:00.000Z", updated_at: "2026-11-11T00:00:00.000Z" }] } }));
    await page.route("**/api/chat/conversation/voice-bound**", (route) => route.fulfill({ json: { ok: true, conversation: { sessionId: "voice-bound", familiarId: "nova", harness: "codex", title: "Voice context", turns: [], createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z" }, context: null } }));
  }
  await page.goto(mobile ? "/?mode=chat#chat-voice-bound" : "/?mode=chat");
  const chat = page.getByTestId("chat-main");
  await expect(chat).toBeVisible();
  if (mobile) {
    await chat.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("menuitem", { name: "Start voice call", exact: true }).click();
  } else {
    const call = chat.getByRole("button", { name: "Voice call", exact: true });
    await expect(call).toBeVisible();
    await call.click();
  }
  await expect(page.getByRole("dialog", { name: "Get started with Cave" })).toBeVisible();
  expect(mints).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __microphoneRequests: number }).__microphoneRequests)).toBe(0);
  expect(f.sends).toEqual([]);
});

test("an existing conversation keeps its different actor, project, mode and draft while defaults need repair", async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  f.revoke();
  const boundProject = { ...PROJECT, id: "existing-project", name: "Existing work", root: "/synthetic/existing", access: "write" };
  const sage = { ...FAMILIARS[0], id: "sage", display_name: "Sage", projectAccess: "write" };
  const session = { id: "bound-thread", title: "Already bound", familiarId: "sage", project_root: boundProject.root, harness: "codex", status: "completed", hasLocalConversation: true, created_at: "2026-11-11T00:00:00.000Z", updated_at: "2026-11-11T00:00:00.000Z" };
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [...FAMILIARS, sage] } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [PROJECT, boundProject] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [session] } }));
  await page.route("**/api/chat/conversation/bound-thread**", (route) => route.fulfill({ json: { ok: true, conversation: { sessionId: session.id, familiarId: "sage", harness: "codex", title: session.title, turns: [], createdAt: session.created_at, updatedAt: session.updated_at }, context: null } }));
  await page.addInitScript(() => {
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("existing-project"));
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "existing-project": ["sage"] }));
    localStorage.setItem("cave:active-familiar", "sage");
    localStorage.setItem("cave:chat-composer-controls:v1", JSON.stringify({ permissionMode: "full" }));
  });
  await page.goto("/?mode=chat#chat-bound-thread");
  const chat = page.getByTestId("chat-main");
  const input = chat.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("Keep the existing conversation context");
  await chat.getByRole("button", { name: (page.viewportSize()?.width ?? 0) < 768 ? "Tools" : "Session options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Review default context", exact: true }).click();
  await page.getByRole("dialog", { name: "Get started with Cave" }).getByRole("button", { name: "Explore first", exact: true }).click();
  await expect(input).toHaveValue("Keep the existing conversation context");
  await page.evaluate(() => { localStorage.setItem("cave:chat-composer-controls:v1", JSON.stringify({ permissionMode: "read" })); window.dispatchEvent(new Event("cave:chat-composer-prefs-changed")); });
  await input.press("Enter");
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]).toMatchObject({ familiarId: "sage", sessionId: "bound-thread", permissionMode: "full", projectRoot: boundProject.root, prompt: "Keep the existing conversation context" });
  expect(f.getState().defaults).toEqual(initial.defaults);
});


test("compact chat cannot substitute a recent or first actor for a revoked default", async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["removed"], actingFamiliarId: "removed" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  f.revoke();
  await page.addInitScript(() => localStorage.setItem("cave.quick-chat.last-familiar", "nova"));
  await page.goto("/quick-chat");
  const pane = page.getByRole("tabpanel");
  await expect(pane.getByRole("button", { name: "Review default context in Cave", exact: true })).toBeVisible();
  const input = pane.getByRole("combobox", { name: "Message", exact: true });
  await expect(input).toHaveAttribute("placeholder", "@sage summarize what needs attention");
  await input.fill("Keep the missing actor explicit");
  await input.press("Enter");
  await expect(input).toHaveValue("Keep the missing actor explicit");
  expect(f.sends).toEqual([]);
  expect(f.getState().defaults?.actingFamiliarId).toBe("removed");
});

test("a failed default-context refresh retains the pending brief without launching through a retry", async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  await page.goto("/?mode=home");
  await expect(page.getByRole("complementary", { name: "Getting started", exact: true })).toContainText("Your workspace is ready.");
  await page.route("**/api/onboarding/journey", (route) => route.fulfill({ status: 503, json: { ok: false, error: "Saved context temporarily unavailable" } }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", { detail: { initialPrompt: "Retain through the failed read" } })));
  await expect(page.getByRole("dialog", { name: "Get started with Cave" })).toContainText("Saved context temporarily unavailable");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("cave:pending-agents-new-chat") ?? "null"))).toMatchObject({ initialPrompt: "Retain through the failed read" });
  expect(f.sends).toEqual([]);
});

test("compact default-derived drafts wait when another scope member needs repair", async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova", "sage"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  await page.goto("/quick-chat");
  const pane = page.getByRole("tabpanel");
  await expect(pane).toContainText(PROJECT.name);
  const input = pane.getByRole("combobox", { name: "Message", exact: true });
  await input.fill("Keep the entire configured scope");
  f.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(pane.getByRole("button", { name: "Review default context in Cave", exact: true })).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue("Keep the entire configured scope");
  expect(f.sends).toEqual([]);
  expect(f.getState().defaults?.familiarIds).toEqual(["nova", "sage"]);
});

for (const outcome of ["failed", "newer"] as const) {
test(`a compact skill invocation preserves the ${outcome === "failed" ? "original brief on failed validation" : "newer draft while validation finishes"}`, async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  await page.route("**/api/skills/local", (route) => route.fulfill({ json: { ok: true, skills: [{ id: "review", name: "Review", description: "Review the chosen project" }] } }));
  await page.goto("/quick-chat");
  const pane = page.getByRole("tabpanel");
  await expect(pane).toContainText(PROJECT.name);
  const input = pane.getByRole("combobox", { name: "Message", exact: true });
  await input.fill("/skill review");
  await expect(pane.getByRole("listbox", { name: "Skills", exact: true })).toBeVisible();
  await input.fill("/skill review --check");
  let release!: () => void;
  const pendingRead = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/onboarding/journey", async (route) => {
    await pendingRead;
    if (outcome === "failed") return route.fulfill({ status: 503, json: { ok: false, error: "Saved context unavailable" } });
    return route.fallback();
  });
  await input.press("Enter");
  await expect(input).toHaveValue("/skill review --check");
  if (outcome === "newer") await input.fill("A newer unsent thought");
  release();
  if (outcome === "failed") {
    await expect(pane).toContainText("Couldn't verify the saved default context");
    await expect(input).toHaveValue("/skill review --check");
    expect(f.sends).toEqual([]);
  } else {
    await expect.poll(() => f.sends.length).toBe(1);
    await expect(input).toHaveValue("A newer unsent thought");
    expect((f.sends[0] as { prompt: string }).prompt).toContain("--check");
  }
});
}


test("Home retains its draft and files when a non-acting default-scope member loses access", async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova", "sage"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [...FAMILIARS.map((f) => ({ ...f, projectAccess: "read" })), { ...FAMILIARS[0], id: "sage", display_name: "Sage", projectAccess: "read" }] } }));
  await page.goto("/?mode=home");
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toBeVisible();
  const home = page.locator(".home-composer-root");
  const input = home.getByRole("textbox", { name: "Chat message" });
  await input.fill("Keep the entire saved scope before starting");
  await home.locator('input[type="file"]').setInputFiles({ name: "scope-evidence.txt", mimeType: "text/plain", buffer: Buffer.from("Scope evidence") });
  await expect(home).toContainText("scope-evidence.txt");
  f.revokeMember("sage"); // Registry/roster remain cached; Nova retains Read access.
  await home.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Get started with Cave" })).toBeVisible();
  await page.getByRole("dialog", { name: "Get started with Cave" }).getByRole("button", { name: "Explore first", exact: true }).click();
  await expect(input).toHaveValue("Keep the entire saved scope before starting");
  await expect(home).toContainText("scope-evidence.txt");
  expect(f.sends).toEqual([]);
});

test("an explicit All projects overview survives hydration with configured defaults", async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  await page.addInitScript(() => {
    localStorage.setItem("cave:workspace:project-scope:v1", "null");
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "__all-projects__": ["nova"] }));
  });
  await page.goto("/?mode=home");
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cave:workspace:project-scope:v1"))).toBe("null");
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cave:workspace:project-scope:v1"))).toBe("null");
  expect(f.sends).toEqual([]);
});


test("host Explore restores after a bound-chat deep link writes automatic composer preferences", async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, permissionMode: "read", practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  const session = { id: "bound-mode", title: "Bound Build chat", familiarId: "nova", project_root: PROJECT.root, harness: "codex", status: "completed", hasLocalConversation: true, created_at: "2026-11-11T00:00:00.000Z", updated_at: "2026-11-11T00:00:00.000Z" };
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [session] } }));
  await page.route("**/api/chat/conversation/bound-mode**", (route) => route.fulfill({ json: { ok: true, conversation: { sessionId: session.id, familiarId: "nova", harness: "codex", turns: [], createdAt: session.created_at, updatedAt: session.updated_at }, context: null } }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/onboarding/journey", async (route) => { await gate; await route.fallback(); });
  await page.goto("/?mode=chat#chat-bound-mode");
  const boundInput = page.getByTestId("chat-main").getByRole("textbox", { name: "Message", exact: true });
  await expect(boundInput).toBeVisible({ timeout: 30_000 });
  release();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cave:chat-composer-controls:v1") ?? "{}").permissionMode)).toBe("read");
  await boundInput.fill("Bound mode remains independent");
  await boundInput.press("Enter");
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]).toMatchObject({ sessionId: "bound-mode", permissionMode: "full" });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", { detail: {} })));
  const newChat = page.getByTestId("chat-main");
  await expect(newChat.getByRole("main", { name: "Work board", exact: true })).toBeVisible();
  await expect(newChat.locator(".cave-composer-panel")).toHaveAttribute("data-access-mode", "read");
  const input = newChat.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("New work uses reviewed Explore");
  await expect(input).toHaveValue("New work uses reviewed Explore");
  await expect(newChat.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await input.press("Enter");
  await expect.poll(() => f.sends.length).toBe(2);
  expect(f.sends[1]).toMatchObject({ permissionMode: "read", projectRoot: PROJECT.root, prompt: "New work uses reviewed Explore", sessionId: null });
});

for (const leave of [false, true]) {
  test(`automatic voice ${leave ? "stays closed after leaving its target" : "waits for project access before opening once"}`, async ({ page }) => {
    const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
    const f = await fixture(page, initial);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => new MediaStream() } });
      Object.assign(window, { SpeechRecognition: class { start() {} stop() {} } });
    });
    await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: FAMILIARS.map((f) => ({ ...f, projectAccess: "read", voiceProvider: "elevenlabs" })) } }));
    const session = { id: "voice-race", title: "Voice context", familiarId: "nova", project_root: PROJECT.root, harness: "codex", status: "completed", hasLocalConversation: true, created_at: "2026-11-11T00:00:00.000Z", updated_at: "2026-11-11T00:00:00.000Z" };
    let minted = false;
    let held = 0;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/projects**", async (route) => {
      if (minted && new URL(route.request().url()).searchParams.get("familiarId") === "nova") { held++; await gate; }
      return route.fulfill({ json: { ok: true, projects: [PROJECT] } });
    });
    await page.route("**/api/chat/conversation", async (route) => {
      minted = true;
      // Model a slow mint beyond the 2.5s actor-project cache lifetime.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return route.fulfill({ json: { ok: true, sessionId: session.id } });
    });
    await page.route("**/api/chat/conversation/voice-race**", (route) => route.fulfill({ json: { ok: true, conversation: { sessionId: session.id, familiarId: "nova", harness: "codex", turns: [], createdAt: session.created_at, updatedAt: session.updated_at }, context: null } }));
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: minted ? [session] : [] } }));
    await page.route("**/api/voice/session", (route) => { calls++; return route.fulfill({ status: 503, json: { ok: false, error: "provider_error", hint: "Synthetic voice service" } }); });
    await page.goto("/?mode=home");
    const home = page.locator(".home-composer-root");
    await home.getByRole("button", { name: "Composer actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Voice call", exact: true }).click();
    await expect(page.getByTestId("chat-main")).toBeVisible();
    await expect.poll(() => held).toBeGreaterThan(0);
    await expect(page.getByRole("dialog", { name: "Nova", exact: true })).toHaveCount(0);
    if (leave) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", { detail: {} })));
      await expect(page.getByTestId("chat-main").getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
    }
    release();
    if (leave) {
      await expect(page.getByTestId("chat-main").getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
      await expect(page.getByRole("dialog", { name: "Nova", exact: true })).toHaveCount(0);
      expect(calls).toBe(0);
    } else {
      await expect(page.getByRole("dialog", { name: "Nova", exact: true })).toBeVisible();
      await expect.poll(() => calls).toBe(1);
    }
    expect(f.sends).toEqual([]);
  });
}


test("a completed bound chat keeps its transcript space and opens guidance from Session options", async ({ page }) => {
  const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, initial);
  const session = { id: "bound-guide", title: "Bound guidance", familiarId: "nova", project_root: PROJECT.root, harness: "codex", status: "completed", hasLocalConversation: true, created_at: "2026-11-11T00:00:00.000Z", updated_at: "2026-11-11T00:00:00.000Z" };
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [session] } }));
  await page.route("**/api/chat/conversation/bound-guide**", (route) => route.fulfill({ json: { ok: true, conversation: { sessionId: session.id, familiarId: "nova", harness: "codex", turns: [], createdAt: session.created_at, updatedAt: session.updated_at }, context: null } }));
  await page.goto("/?mode=chat#chat-bound-guide");
  const chat = page.getByTestId("chat-main");
  const input = chat.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toBeVisible();
  await input.fill("Retain this bound draft while checking guidance");
  await expect(page.locator(".first-use-nudge")).toHaveCount(0);
  const guidanceMenu = chat.getByRole("button", { name: (page.viewportSize()?.width ?? 0) < 768 ? "Tools" : "Session options", exact: true });
  await guidanceMenu.click();
  await expect(page.getByRole("menuitem", { name: "Working with familiars", exact: true })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: `artifacts/issue-6458/approval-guidance-menu-${test.info().project.name}.png` });
  await page.getByRole("menuitem", { name: "Working with familiars", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Get started with Cave" });
  await expect(guide).toBeVisible();
  await expect(guide).toHaveCSS("opacity", "1");
  await page.screenshot({ animations: "disabled", path: `artifacts/issue-6458/approval-guidance-open-${test.info().project.name}.png` });
  await guide.getByRole("button", { name: "Explore first", exact: true }).click();
  await expect(input).toHaveValue("Retain this bound draft while checking guidance");
  await expect(guidanceMenu).toBeFocused();
  expect(f.sends).toEqual([]);
});
