import { expect, test, type Page } from "@playwright/test";

const SESSION = "approve-questions";
const ISO = "2026-09-09T12:00:00.000Z";
const QUESTIONS = [
  "Choose how to proceed.",
  '<coven:approve kind="questions" id="auth" prompt="Which auth?" options="Cookies|JWT" />',
  '<coven:approve kind="questions" id="store" prompt="Which store?" options="SQLite|Postgres" other="no" />',
  '<coven:attention reason="decision" />',
].join("\n");

async function setup(page: Page, options: { text?: string; reject?: boolean; historical?: boolean; holdSend?: Promise<void> } = {}) {
  const sends: Record<string, unknown>[] = [];
  let saved = false;
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:familiar:cody:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    familiars: [{ id: "cody", display_name: "Cody", role: "Code familiar", status: "active", icon: "ph:code" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{
      id: SESSION, title: "Approval questions", status: "idle", project_root: "/tmp/coven-cave",
      harness: "claude", familiarId: "cody", model: "test", runtime: "local:/tmp/coven-cave",
      exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO,
    }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "p1", name: "Cave", root: "/tmp/coven-cave", access: "write" }],
  } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: {
    ok: true, state: { familiarId: "cody", harness: "claude", effectiveModel: "test", source: "session", applicationState: "saved" },
  } }));
  await page.route("**/api/chat/conversation/**", (route) => {
    const subsequent = saved || options.historical;
    return route.fulfill({ json: {
      ok: true,
      conversation: {
        activeLeafId: subsequent ? "a2" : "a1",
        turns: [
          { id: "u1", parentId: null, role: "user", text: "Ask me how to proceed.", createdAt: ISO },
          { id: "a1", parentId: "u1", role: "assistant", text: options.text ?? QUESTIONS, createdAt: ISO },
          ...(subsequent ? [
            { id: "u2", parentId: "a1", role: "user", text: sends[0]?.prompt ?? "Continue without those choices.", createdAt: ISO },
            { id: "a2", parentId: "u2", role: "assistant", text: "Received your choices.", createdAt: ISO },
          ] : []),
        ],
      },
    } });
  });
  await page.route("**/api/chat/send", async (route) => {
    sends.push(route.request().postDataJSON());
    await options.holdSend;
    if (options.reject) return route.fulfill({ status: 503, json: { ok: false, error: "Test bridge unavailable" } });
    saved = true;
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        { kind: "assistant_chunk", text: "Received your choices." },
        { kind: "done", sessionId: SESSION },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  await page.goto(`/?mode=chat#chat-${SESSION}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.getByText("Choose how to proceed.", { exact: true })).toBeVisible({ timeout: 45_000 });
  return { chat, sends };
}

test("production marker sends choices as the next user turn without consuming the composer draft", async ({ page }) => {
  const { chat, sends } = await setup(page);
  const card = chat.getByRole("form", { name: "Questions from familiar" });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("radiogroup")).toHaveCount(2);
  await expect(card.getByRole("radio", { name: "Other", exact: true })).toHaveCount(1);
  const composer = chat.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Keep this separate draft.");
  await card.getByRole("radio", { name: "Cookies", exact: true }).check();
  await card.getByRole("radio", { name: "Postgres", exact: true }).check();
  expect(sends).toHaveLength(0);
  await card.getByRole("button", { name: "Send answers", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({
    sessionId: SESSION, parentTurnId: "a1",
    prompt: "Which auth? → Cookies\nWhich store? → Postgres",
  });
  expect(sends[0].attachments).toBeUndefined();
  await expect(chat.locator(".cave-bubble-user").last()).toContainText("Which auth? → Cookies");
  await expect(chat.locator('[data-approve-phase="sent"]')).toBeVisible();
  await expect(composer).toHaveValue("Keep this separate draft.");
  await expect(chat.locator(".cave-bubble-assistant")).not.toContainText(["<coven:approve"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(chat.locator(".cave-bubble-user").last()).toContainText("Which store? → Postgres", { timeout: 30_000 });
  await expect(chat.getByRole("button", { name: "Send answers", exact: true })).toBeDisabled();
  expect(sends).toHaveLength(1);
});

test("Other is keyboard accessible and sends text only after the explicit gesture", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { chat, sends } = await setup(page);
  const card = chat.getByRole("form", { name: "Questions from familiar" });
  const cookies = card.getByRole("radio", { name: "Cookies", exact: true });
  await cookies.focus();
  await page.keyboard.press("ArrowRight");
  await expect(card.getByRole("radio", { name: "JWT", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(card.getByRole("radio", { name: "Other", exact: true })).toBeChecked();
  await page.keyboard.press("Tab");
  const other = card.getByRole("textbox", { name: "Other answer for: Which auth?" });
  await expect(other).toBeFocused();
  await other.fill("OAuth only");
  expect(sends).toHaveLength(0);
  await card.getByRole("button", { name: "Send answers", exact: true }).click();
  await expect.poll(() => sends[0]?.prompt).toBe("Which auth? → OAuth only");
});

test("a rejected send is never labelled sent", async ({ page }) => {
  const { chat, sends } = await setup(page, { reject: true });
  const card = chat.getByRole("form", { name: "Questions from familiar" });
  await card.getByRole("radio", { name: "Cookies", exact: true }).check();
  await card.getByRole("button", { name: "Send answers", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  await expect(card.getByRole("alert")).toContainText("Answers were not confirmed");
  await expect(chat.locator('[data-approve-phase="sent"]')).toHaveCount(0);
});

test("historical questions cannot send again", async ({ page }) => {
  const { chat, sends } = await setup(page, { historical: true });
  await expect(chat.getByRole("button", { name: "Send answers", exact: true })).toBeDisabled();
  expect(sends).toHaveLength(0);
});

test("a pending answer send disables every question card without queueing another answer", async ({ page }) => {
  let releaseSend: () => void = () => {};
  const holdSend = new Promise<void>((resolve) => { releaseSend = resolve; });
  const { chat, sends } = await setup(page, {
    holdSend,
    text: `${QUESTIONS.replace('<coven:attention reason="decision" />', "")}
<coven:approve kind="questions" id="cache" prompt="Which cache?" options="Memory|Redis" />
<coven:approve kind="questions" id="queue" prompt="Which queue?" options="Local|Remote" />`,
  });
  const cards = chat.getByRole("form", { name: "Questions from familiar" });
  const card = cards.first();
  await expect(cards).toHaveCount(2);
  await cards.last().getByRole("radio", { name: "Local", exact: true }).check();
  await card.getByRole("radio", { name: "Cookies", exact: true }).check();
  await card.getByRole("button", { name: "Send answers", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  await expect(card.getByRole("button", { name: "Sending answers", exact: false })).toBeDisabled();
  await expect(card.getByRole("radio", { name: "Cookies", exact: true })).toBeDisabled();
  await expect(cards.last().getByRole("button", { name: "Send answers", exact: true })).toBeDisabled();
  await expect(chat.locator('[data-approve-phase="sent"]')).toHaveCount(0);
  releaseSend();
  await expect(chat.locator('[data-approve-phase="sent"]')).toBeVisible();
  expect(sends).toHaveLength(1);
});

test("malformed and incomplete markers stay hidden alongside a literal fenced example", async ({ page }) => {
  const literal = '<coven:approve kind="questions" prompt="Example?" options="One|Two" />';
  const { chat, sends } = await setup(page, { text: [
    "Choose how to proceed.",
    '<coven:approve kind="command" prompt="Unsupported?" options="Run|Skip" />',
    '<coven:approve kind=questions>',
    "```text", literal, "```",
    '<coven:approve kind="ques',
  ].join("\n") });
  await expect(chat.getByRole("form", { name: "Questions from familiar" })).toHaveCount(0);
  await expect(chat.locator("code").filter({ hasText: literal })).toBeVisible();
  await expect(chat).not.toContainText("Unsupported?");
  await expect(chat).not.toContainText("kind=questions");
  expect(sends).toHaveLength(0);
});

test("question attribute backticks do not hide sibling preview cards", async ({ page }) => {
  const { chat } = await setup(page, { text: [
    "Choose how to proceed.",
    '<coven:approve kind="questions" prompt="Keep the ` delimiter?" options="Keep|Remove" />',
    '<coven:preview url="http://localhost:3007" title="Sibling preview" />',
    '<coven:approve kind="questions" prompt="And this ` delimiter?" options="Keep|Remove" />',
  ].join("\n") });
  await expect(chat.getByRole("form", { name: "Questions from familiar" })).toHaveCount(2);
  await expect(chat.getByText("Sibling preview", { exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Open beside chat", exact: true })).toBeVisible();
});

test("questions remain readable in light mode, another theme, and a narrow pane", async ({ page }, testInfo) => {
  const { chat } = await setup(page);
  const card = chat.getByRole("form", { name: "Questions from familiar" });
  for (const appearance of [
    { theme: "coven", mode: "dark", width: 1280 },
    { theme: "coven", mode: "light", width: 1280 },
    { theme: "tide", mode: "dark", width: 720 },
  ]) {
    await page.setViewportSize({ width: appearance.width, height: 900 });
    await page.evaluate(({ theme, mode }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
    }, appearance);
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("radio", { name: "Cookies", exact: true })).toBeVisible();
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const colors = await card.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, foreground: style.color };
    });
    expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(colors.background).not.toBe(colors.foreground);
    await card.screenshot({ path: testInfo.outputPath(`questions-${appearance.theme}-${appearance.mode}.png`) });
  }
});
