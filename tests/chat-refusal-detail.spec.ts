import { expect, test, type Page } from "@playwright/test";

// #6095: a send refused for a local session before anything ran shows its
// reason once. The "Why it failed" panel says nothing ran instead of claiming
// that detail is withheld; any other refusal keeps the withheld copy.
const ISO = "2026-10-20T00:00:00.000Z";
const WITHHELD = "A runtime step failed. Its detail is withheld to protect project data.";
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function sendRefused(page: Page, refusal: { code: string; error: string }) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    // The strip keys off the refusal, not the runtime; these mirror
    // chat-auth-recovery.spec.ts so no unmocked model discovery gates Send.
    familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "claude", icon: "ph:sparkle-fill" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{ id: "refusal-detail", title: "Refusal detail", status: "idle", project_root: "/tmp/coven-cave", harness: "copilot", familiarId: "nova", model: "test", runtime: "local:/tmp/coven-cave", exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "p1", name: "Coven Cave", root: "/tmp/coven-cave", access: "write" }],
  } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true, conversation: { activeLeafId: "a1", turns: [{ id: "a1", parentId: null, role: "assistant", text: "Ready for a message.", createdAt: ISO }] },
  } }));
  await page.route("**/api/vault**", (route) => route.fulfill({ json: { ok: true, mappings: [] } }));
  let sends = 0;
  await page.route("**/api/chat/send", (route) => {
    sends += 1;
    return route.fulfill({ status: 409, json: { ok: false, ...refusal } });
  });
  await page.goto("/?mode=chat#chat-refusal-detail", { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
  await chat.locator(".cave-composer-input").fill("Say hello.");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sends).toBe(1);
  const strip = chat.locator(".cave-chat-error-strip");
  await expect(strip.getByText("Why it failed", { exact: true })).toBeVisible();
  return strip;
}

test("a local server refusal shows its reason once, with no withheld line", async ({ page }, testInfo) => {
  const error = "Ollama isn't reachable at http://127.0.0.1:11434. Start Ollama (open the app, or run `ollama serve`). Then send again.";
  const strip = await sendRefused(page, { code: "local_server_unreachable", error });
  await expect(strip.getByText(`request failed (409): local_server_unreachable: ${error}`, { exact: true })).toBeVisible();
  await expect(strip.getByText("request refused", { exact: true })).toBeVisible();
  await expect(strip.getByText("Nothing ran. The reason is shown above.", { exact: true })).toBeVisible();
  await expect(strip.getByText(/withheld/)).toHaveCount(0);
  await expect(strip.getByText(/isn't reachable/)).toHaveCount(1);
  await strip.screenshot({ path: testInfo.outputPath("local-refusal.png"), animations: "disabled" });
});

test("a refusal outside the local list keeps the withheld copy", async ({ page }) => {
  const error = "Flow executions are read-only in Chat. Use Discuss in Chat to start a linked conversation.";
  const strip = await sendRefused(page, { code: "flow_session_read_only", error });
  await expect(strip.getByText(`request failed (409): flow_session_read_only: ${error}`, { exact: true })).toBeVisible();
  await expect(strip.getByText(WITHHELD, { exact: true })).toBeVisible();
  await expect(strip.getByText("Nothing ran. The reason is shown above.", { exact: true })).toHaveCount(0);
});
