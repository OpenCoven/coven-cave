import { expect, test, type Page } from "@playwright/test";
import { advanceFirstUse, createFirstUseState, type FirstUseState } from "../src/lib/first-use";

test.use({ serviceWorkers: "block" });
const PROJECT = { id: "first-project", name: "Practice garden", root: "/synthetic/garden", createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z", access: "read" };
const FAMILIARS = [{ id: "nova", display_name: "Nova", role: "Planner", harness: "codex", status: "active" }];

async function fixture(page: Page, initial: FirstUseState = createFirstUseState()) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { ok: false, error: "Outside the isolated first-use fixture" } }));
  let state = initial;
  let revoked = false;
  let runtime = true;
  let accessLevel: "read" | "write" = "read";
  const sends: unknown[] = [];
  const actions: unknown[] = [];
  await page.addInitScript(() => { localStorage.setItem("cave:onboarding:dismissed", "1"); });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: FAMILIARS.map((f) => ({ ...f, projectAccess: revoked ? null : "read" })) } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [PROJECT] } }));
  await page.route("**/api/project-grants**", (route) => route.fulfill({ json: { ok: true, grants: revoked ? [] : [{ familiarId: "nova", projectId: PROJECT.id, access: accessLevel }], accessGroups: [], supremeFamiliarId: null } }));
  await page.route("**/api/harnesses**", (route) => route.fulfill({ json: { ok: true, harnesses: [{ id: "codex", label: "Codex", installed: runtime, chatSupported: true }] } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: { ok: true, state: { familiarId: "nova", runtime: null, harness: "codex", effectiveModel: "unknown", source: "runtime-default", applicationState: "saved", reason: "Synthetic runtime" } } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route("**/api/onboarding/journey", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.revision !== state.revision) return route.fulfill({ status: 409, json: { ok: false, code: "first_use_changed", error: "The introduction changed in another window. Reload it before continuing." } });
      actions.push(body.action);
      state = advanceFirstUse(state, body.action);
    }
    const resolution = !state.defaults || revoked
      ? { kind: "repair", context: state.defaults, reason: revoked ? "access" : "missing", message: revoked ? "A saved familiar no longer has project access. Review access or choose another scope." : "Choose a default project and familiar scope to start new work." }
      : { kind: "ready", context: state.defaults };
    return route.fulfill({ json: { ok: true, state, resolution, project: state.defaults ? PROJECT : null, access: state.defaults ? state.defaults.familiarIds.map((familiarId) => ({ familiarId, level: revoked ? null : familiarId === "nova" ? accessLevel : "read", direct: revoked ? null : familiarId === "nova" ? accessLevel : "read", groups: [], supreme: false })) : [], starterRoot: "/synthetic/cave-starter" } });
  });
  await page.route("**/api/chat/send", (route) => { sends.push(route.request().postDataJSON()); return route.fulfill({ contentType: "text/event-stream", body: 'data: {"kind":"done","sessionId":"practice-real-chat"}\n\n' }); });
  return { getState: () => state, actions, sends, revoke: () => { revoked = true; }, restore: () => { revoked = false; }, disableRuntime: () => { runtime = false; }, allowWrite: () => { accessLevel = "write"; }, changeInOtherWindow: () => { state = { ...state, revision: state.revision + 1 }; } };
}

test("the introduction resumes after dismissal and teaches the full method before execution", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/?mode=home");
  const guide = page.getByRole("dialog", { name: /Start with an outcome/ });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Plan a small change", exact: true }).click();
  await guide.getByRole("button", { name: "Default project", exact: true }).click();
  await page.getByRole("menuitemradio", { name: `${PROJECT.name} ${PROJECT.root}`, exact: true }).click();
  await guide.getByRole("checkbox", { name: "Nova", exact: true }).check();
  await guide.getByRole("button", { name: "Acting familiar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Nova", exact: true }).click();
  await guide.getByRole("button", { name: "Save default context", exact: true }).click();
  await expect(guide).toContainText("Read access");
  await guide.getByRole("button", { name: "Continue later", exact: true }).click();
  expect(f.getState().completedAt).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "Continue introduction", exact: true }).click();
  await guide.getByRole("radio", { name: "Explore · read only", exact: true }).check();
  await guide.getByRole("button", { name: "Continue to approvals", exact: true }).click();
  await guide.getByRole("button", { name: "Wait for approval", exact: true }).click();
  await expect(guide).toContainText("Approve the practice plan");
  await guide.getByRole("button", { name: "Approve practice step", exact: true }).click();
  await guide.getByRole("button", { name: "Stop practice run", exact: true }).click();
  await expect(guide).toContainText("Stopped");
  await guide.getByRole("button", { name: "Retry practice run", exact: true }).click();
  await guide.getByRole("button", { name: "The familiar said it’s done", exact: true }).click();
  await expect(guide).toContainText("Compare the result");
  expect(f.getState().completedAt).toBeNull();
  await guide.getByRole("button", { name: "The result and its check meet the outcome", exact: true }).click();
  expect(f.getState().step).toBe("complete");
  expect(f.sends).toEqual([]);
  expect(f.actions).toContainEqual({ kind: "stop" });
  expect(f.getState().defaults).toEqual({ projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" });
  await guide.getByRole("button", { name: "Return to my work", exact: true }).click();
  const home = page.locator(".home-composer-root");
  const firstBrief = home.getByRole("textbox", { name: "Chat message" });
  await expect(firstBrief).toBeEditable();
  await firstBrief.fill("Explain this project’s entry point");
  await expect(firstBrief).toHaveValue("Explain this project’s entry point");
  await home.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]).toMatchObject({ familiarId: "nova", projectRoot: PROJECT.root, permissionMode: "read" });
});

test("a saved default is restored while All chats remains the overview", async ({ page }) => {
  const state: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  await fixture(page, state);
  await page.goto("/?mode=chat");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cave:workspace:project-scope:v1"))).toBe(JSON.stringify(PROJECT.id));
  await expect(page.getByRole("button", { name: /All chats/ }).first()).toBeVisible();
});

test("revoked defaults require repair and preserve their stable identities", async ({ page }) => {
  const state: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, state);
  f.revoke();
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Review default context", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Start with an outcome/ })).toContainText("no longer has project access");
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
  const guide = page.getByRole("dialog", { name: /Start with an outcome/ });
  await expect(guide).toBeVisible();
  expect(f.sends).toEqual([]);
  await guide.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(home.getByRole("textbox", { name: "Chat message" })).toHaveValue("Keep this outcome and its evidence");
  await expect(home).toContainText("evidence.txt");
});

test("an unavailable runtime has a repair action and cannot finish default configuration", async ({ page }) => {
  const f = await fixture(page, advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }));
  f.disableRuntime();
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Continue introduction", exact: true }).click();
  const guide = page.getByRole("dialog", { name: /Start with an outcome/ });
  await guide.getByRole("button", { name: "Default project", exact: true }).click();
  await page.getByRole("menuitemradio", { name: `${PROJECT.name} ${PROJECT.root}`, exact: true }).click();
  await guide.getByRole("checkbox", { name: "Nova", exact: true }).check();
  await guide.getByRole("button", { name: "Acting familiar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Nova", exact: true }).click();
  await expect(guide).toContainText("runtime is unavailable");
  await expect(guide.getByRole("button", { name: "Open setup", exact: true })).toBeVisible();
  await expect(guide.getByRole("button", { name: "Save default context", exact: true })).toBeDisabled();
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
  await expect(page.getByRole("dialog", { name: /Start with an outcome/ })).toBeVisible();
  expect(launches).toBe(0);
  expect(f.sends).toEqual([]);
});

test("the guide contains keyboard focus and fits narrow light and alternate-theme layouts", async ({ page }, testInfo) => {
  await fixture(page, advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" }));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/?mode=home");
  const trigger = page.getByRole("button", { name: "Continue introduction", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const guide = page.getByRole("dialog", { name: /Start with an outcome/ });
  await expect(guide).toBeVisible();
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label") }));
    await expect.poll(() => guide.evaluate((element) => element.contains(document.activeElement)), { message: `Tab ${index}: ${JSON.stringify(active)}` }).toBe(true);
  }
  for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
    await page.evaluate(([theme, mode]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, [theme, mode]);
    expect(await guide.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`guide-narrow-${theme}-${mode}.png`) });
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
    await expect(page.getByRole("button", { name: "Continue introduction", exact: true })).toBeVisible();
    if (entry === "live") await page.evaluate((request) => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", { detail: request })), request);
    await expect(page.getByRole("dialog", { name: /Start with an outcome/ })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("cave:pending-agents-new-chat") ?? "null"))).toMatchObject(request);
    expect(f.sends).toEqual([]);
  });
}

test("a removed familiar stays visible for explicit scope repair before choosing a replacement", async ({ page }) => {
  const state: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, state);
  f.revoke();
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [{ id: "sage", display_name: "Sage", role: "Planner", harness: "codex", projectAccess: "read" }] } }));
  await page.route("**/api/project-grants**", (route) => route.fulfill({ json: { ok: true, grants: [{ familiarId: "sage", projectId: PROJECT.id, access: "read" }], accessGroups: [], supremeFamiliarId: null } }));
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Review default context", exact: true }).click();
  const guide = page.getByRole("dialog", { name: /Start with an outcome/ });
  const removed = guide.getByRole("checkbox", { name: "Unavailable familiar nova", exact: true });
  await expect(removed).toBeChecked();
  expect(f.getState().defaults?.familiarIds).toEqual(["nova"]);
  await removed.uncheck();
  await guide.getByRole("checkbox", { name: "Sage", exact: true }).check();
  await guide.getByRole("button", { name: "Acting familiar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Sage", exact: true }).click();
  f.restore();
  await guide.getByRole("button", { name: "Save default context", exact: true }).click();
  expect(f.getState().defaults).toEqual({ projectId: PROJECT.id, familiarIds: ["sage"], actingFamiliarId: "sage" });
});

test("a stale context form offers an explicit reload before it can save the current revision", async ({ page }) => {
  const state: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
  const f = await fixture(page, state);
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Working with familiars", exact: true }).click();
  const guide = page.getByRole("dialog", { name: /Start with an outcome/ });
  await guide.getByRole("button", { name: "Change default context", exact: true }).click();
  await expect(guide.getByRole("button", { name: "Save default context", exact: true })).toBeEnabled();
  f.changeInOtherWindow();
  await guide.getByRole("button", { name: "Save default context", exact: true }).click();
  await expect(guide).toContainText("changed in another window");
  const reload = guide.getByRole("button", { name: "Reload saved context", exact: true });
  await expect(reload).toBeVisible();
  await reload.click();
  await guide.getByRole("button", { name: "Save default context", exact: true }).click();
  await expect.poll(() => f.getState().revision).toBe(10);
});

test("changing from a Write actor to a Read actor requires a new access choice", async ({ page }) => {
  let state = advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" });
  state = advanceFirstUse(state, { kind: "context", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" } });
  const f = await fixture(page, state);
  f.allowWrite();
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [...FAMILIARS, { id: "sage", display_name: "Sage", role: "Planner", harness: "codex", projectAccess: "read" }] } }));
  await page.route("**/api/project-grants**", (route) => route.fulfill({ json: { ok: true, grants: [{ familiarId: "nova", projectId: PROJECT.id, access: "write" }, { familiarId: "sage", projectId: PROJECT.id, access: "read" }], accessGroups: [], supremeFamiliarId: null } }));
  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Continue introduction", exact: true }).click();
  const guide = page.getByRole("dialog", { name: /Start with an outcome/ });
  await guide.getByRole("radio", { name: "Build · full access", exact: true }).check();
  await guide.getByRole("button", { name: "Change context", exact: true }).click();
  await guide.getByRole("checkbox", { name: "Nova", exact: true }).uncheck();
  await guide.getByRole("checkbox", { name: "Sage", exact: true }).check();
  await guide.getByRole("button", { name: "Acting familiar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Sage", exact: true }).click();
  await guide.getByRole("button", { name: "Save default context", exact: true }).click();
  await expect(guide.getByRole("button", { name: "Continue to approvals", exact: true })).toBeDisabled();
  await guide.getByRole("radio", { name: "Explore · read only", exact: true }).check();
  await guide.getByRole("button", { name: "Continue to approvals", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:chat-composer-controls:v1") ?? "{}").permissionMode)).toBe("read");
});

for (const presentation of ["tray", "notch"] as const) {
  test(`${presentation} restores concrete defaults and keeps its draft when introduction needs the main window`, async ({ page }) => {
    const initial: FirstUseState = { version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: PROJECT.id, familiarIds: ["nova"], actingFamiliarId: "nova" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T12:00:00.000Z" };
    const f = await fixture(page, initial);
    await page.addInitScript(() => { localStorage.setItem("cave.quick-chat.last-familiar", "old-actor"); localStorage.setItem("cave:chat-composer-controls:v1", JSON.stringify({ permissionMode: "read" })); });
    await page.goto(presentation === "notch" ? "/quick-chat?notch=1" : "/quick-chat");
    if (presentation === "notch") await page.getByTitle("Open quick chat", { exact: true }).click();
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
    await page.goto(presentation === "notch" ? "/quick-chat?notch=1" : "/quick-chat");
    if (presentation === "notch") await page.getByTitle("Open quick chat", { exact: true }).click();
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
  const guide = page.getByRole("dialog", { name: /Start with an outcome/ });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Continue later", exact: true }).click();
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
  await expect(page.getByRole("dialog", { name: /Start with an outcome/ })).toBeVisible();
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
  await page.getByRole("button", { name: "Review default context", exact: true }).click();
  await page.getByRole("dialog", { name: /Start with an outcome/ }).getByRole("button", { name: "Continue later", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Working with familiars", exact: true })).toBeVisible();
  await page.route("**/api/onboarding/journey", (route) => route.fulfill({ status: 503, json: { ok: false, error: "Saved context temporarily unavailable" } }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", { detail: { initialPrompt: "Retain through the failed read" } })));
  const repair = page.getByRole("region", { name: "Pending chat needs review", exact: true });
  await expect(repair).toContainText("Couldn't verify the saved context");
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
