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
  await page.route("**/api/projects**", (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      confirms.push({ url: new URL(request.url()).pathname, body: request.postDataJSON() });
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

  const strip = chat.getByRole("alert").filter({ hasText: "Confirm this project’s folder before starting chat." });
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
  expect(sends[1].text ?? sends[1].message).toBe(sends[0].text ?? sends[0].message);
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
