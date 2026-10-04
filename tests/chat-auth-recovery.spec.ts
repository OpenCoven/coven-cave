import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-10-03T00:00:00.000Z";
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function setup(page: Page, configuration: boolean) {
  const sends: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    // The current default differs from the runtime that actually failed.
    familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "claude", icon: "ph:sparkle-fill" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{ id: "auth-recovery", title: "Auth recovery", status: "idle", project_root: "/tmp/coven-cave", harness: "copilot", familiarId: "nova", model: "test", runtime: "local:/tmp/coven-cave", exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "p1", name: "Coven Cave", root: "/tmp/coven-cave", access: "write" }],
  } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true, conversation: { activeLeafId: "a1", turns: [{ id: "a1", parentId: null, role: "assistant", text: "Ready for a message.", createdAt: ISO }] },
  } }));
  await page.route("**/api/vault**", (route) => route.fulfill({ json: { ok: true, mappings: [] } }));
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON());
    const code = configuration ? "harness_auth_configuration_required" : "harness_auth_required";
    const message = configuration ? "Codex needs its API key repaired in this familiar's Vault." : "Codex needs sign-in. Connect it, then retry.";
    return route.fulfill({ contentType: "text/event-stream", body: [
      { kind: "error", code, message, harness: "codex" },
      { kind: "done", sessionId: "auth-recovery", isError: true },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
  await page.goto("/?mode=chat#chat-auth-recovery", { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
  await chat.locator(".cave-composer-input").fill("Keep this exact message for retry.");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sends.length).toBe(1);
  return { chat, sends };
}

test("Connect uses the failed runtime and reaps its temporary terminal", async ({ page }) => {
  const frames: Buffer[] = [];
  await page.routeWebSocket("**/api/pty-ws**", (socket) => {
    socket.onMessage((message) => frames.push(Buffer.from(message)));
  });
  const { chat, sends } = await setup(page, false);
  const connect = chat.getByRole("button", { name: "Connect Codex", exact: true });
  await expect(connect).toBeVisible();
  await expect(chat.getByRole("button", { name: "Connect Claude", exact: true })).toHaveCount(0);
  // WebKit pointer activation can leave focus on the preceding control.
  await chat.locator(".cave-composer-input").focus();
  await connect.dispatchEvent("click");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(() => frames.filter((frame) => frame[0] === 0x03).map((frame) => frame.subarray(1).toString()).join("")).toBe("codex login\r");
  await dialog.getByRole("button", { name: "Close terminal" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => frames.filter((frame) => frame[0] === 0x05).length).toBe(1);
  await expect(connect).toBeFocused();
  await chat.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1].prompt).toBe(sends[0].prompt);
});

for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
  test(`Vault recovery keeps Chat mounted in ${theme}/${mode}`, async ({ page }, testInfo) => {
    const { chat, sends } = await setup(page, true);
    await page.evaluate(([theme, mode]) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
    }, [theme, mode]);
    const open = chat.getByRole("button", { name: "Open familiar Vault", exact: true });
    await expect(open).toBeVisible();
    await expect(chat.getByText("harness_auth_configuration_required", { exact: true })).toHaveCount(0);
    await expect(chat.getByRole("button", { name: /^Connect / })).toHaveCount(0);
    const url = page.url();
    await chat.locator(".cave-composer-input").focus();
    await open.dispatchEvent("click");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Save your credentials, then close the Vault and retry your message.")).toBeVisible();
    await expect(dialog.getByText("No environment variables added", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`vault-${theme}-${mode}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(page.url()).toBe(url);
    await chat.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => sends.length).toBe(2);
    expect(sends[1].prompt).toBe(sends[0].prompt);
  });
}
