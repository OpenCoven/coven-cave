import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const SESSION = "approve-questions";
const ISO = "2026-09-09T12:00:00.000Z";
const QUESTIONS = [
  "Choose how to proceed.",
  '<coven:approve kind="questions" id="auth" prompt="Which auth?" options="Cookies|JWT" />',
  '<coven:approve kind="questions" id="store" prompt="Which store?" options="SQLite|Postgres" other="no" />',
  '<coven:attention reason="decision" />',
].join("\n");

async function setup(page: Page, options: {
  text?: string;
  reject?: boolean;
  historical?: boolean;
  fresh?: boolean;
  missingIdentity?: boolean;
  branched?: boolean;
  holdSend?: Promise<void>;
} = {}) {
  const sends: Record<string, unknown>[] = [];
  const turns = options.fresh ? [
    { id: "u0", parentId: null, role: "user", text: "Keep this earlier context.", createdAt: ISO },
    { id: "a0", parentId: "u0", role: "assistant", text: "Ready for your request.", createdAt: ISO },
  ] : [
    { id: "u1", parentId: null, role: "user", text: "Ask me how to proceed.", createdAt: ISO },
    { id: "a1", parentId: "u1", role: "assistant", text: options.text ?? QUESTIONS, createdAt: ISO },
  ];
  let activeLeafId = turns.at(-1)!.id;
  if (options.branched) {
    // An identical, newer sibling must not become the answer's parent.
    turns.push({ id: "a-other", parentId: "u1", role: "assistant", text: QUESTIONS, createdAt: "2026-09-09T12:01:00.000Z" });
  }
  if (options.historical) {
    turns.push(
      { id: "u2", parentId: "a1", role: "user", text: "Continue without those choices.", createdAt: ISO },
      { id: "a2", parentId: "u2", role: "assistant", text: "Received your choices.", createdAt: ISO },
    );
    activeLeafId = "a2";
  }
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
    return route.fulfill({ json: {
      ok: true,
      conversation: { activeLeafId, turns },
    } });
  });
  await page.route("**/api/chat/send", async (route) => {
    const request = route.request().postDataJSON();
    sends.push(request);
    await options.holdSend;
    if (options.reject) return route.fulfill({ status: 503, json: { ok: false, error: "Test bridge unavailable" } });
    const firstStream = options.fresh && sends.length === 1;
    const userId = firstStream ? "u1" : "u2";
    const assistantId = firstStream ? "a1" : "a2";
    const text = firstStream ? QUESTIONS : "Received your choices.";
    // Model the real persistence boundary: do not silently repair a bad parent
    // sent by the client, or reload would conceal this regression.
    turns.push(
      { id: userId, parentId: request.parentTurnId ?? activeLeafId, role: "user", text: request.prompt, createdAt: ISO },
      { id: assistantId, parentId: userId, role: "assistant", text, createdAt: ISO },
    );
    activeLeafId = assistantId;
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        { kind: "assistant_chunk", text },
        { kind: "done", sessionId: SESSION, ...(!options.missingIdentity ? { persistedTurnId: assistantId } : {}) },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  await page.goto(`/?mode=chat#chat-${SESSION}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.getByText(options.fresh ? "Ready for your request." : "Choose how to proceed.", { exact: true })).toBeVisible({ timeout: 45_000 });
  return { chat, sends, turns };
}

test("freshly streamed questions retain the complete ancestry after answering and reloading", async ({ page }) => {
  const { chat, sends, turns } = await setup(page, { fresh: true });
  const composer = chat.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Ask me how to proceed.");
  await composer.press("Enter");
  const card = chat.getByRole("form", { name: "Questions from familiar" });
  await card.getByRole("radio", { name: "Cookies", exact: true }).check();
  await expect(card.getByRole("button", { name: "Send answers", exact: true })).toBeEnabled();
  const displayedTurnId = await card.evaluate((element) => element.closest("[data-turn-id]")?.getAttribute("data-turn-id"));
  expect(displayedTurnId).toBeTruthy();
  expect(displayedTurnId).not.toBe("a1");
  await card.getByRole("button", { name: "Send answers", exact: true }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1]).toMatchObject({ parentTurnId: "a1", prompt: "Which auth? → Cookies" });
  expect(turns.find((turn) => turn.id === "u2")?.parentId).toBe("a1");
  await expect(chat.locator('[data-approve-phase="sent"]')).toBeVisible();
  await expect(chat.getByText("Keep this earlier context.", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(chat.getByText("Keep this earlier context.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByText("Ask me how to proceed.", { exact: true })).toBeVisible();
  await expect(chat.getByText("Choose how to proceed.", { exact: true })).toBeVisible();
  await expect(chat.locator(".cave-bubble-user").last()).toContainText("Which auth? → Cookies");
  await expect(chat.getByRole("button", { name: "Send answers", exact: true })).toBeDisabled();
  expect(sends).toHaveLength(2);
});

test("fresh questions without a persistence identity require reload, not a guessed parent", async ({ page }) => {
  const { chat, sends } = await setup(page, { fresh: true, missingIdentity: true });
  const composer = chat.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Ask me how to proceed.");
  await composer.press("Enter");
  const card = chat.getByRole("form", { name: "Questions from familiar" });
  await expect(card).toContainText("Reload this chat before sending answers");
  await expect(card.getByRole("button", { name: "Send answers", exact: true })).toBeDisabled();
  expect(sends).toHaveLength(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await card.getByRole("radio", { name: "Cookies", exact: true }).check();
  await card.getByRole("button", { name: "Send answers", exact: true }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1].parentTurnId).toBe("a1");
});

test("saved questions keep their selected branch despite identical newer sibling text", async ({ page }) => {
  const { chat, sends, turns } = await setup(page, { branched: true });
  const card = chat.getByRole("form", { name: "Questions from familiar" });
  await card.getByRole("radio", { name: "Cookies", exact: true }).check();
  await card.getByRole("button", { name: "Send answers", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].parentTurnId).toBe("a1");
  expect(turns.find((turn) => turn.id === "a-other")?.parentId).toBe("u1");
  await expect(chat.locator('[data-approve-phase="sent"]')).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(chat.getByText("Ask me how to proceed.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(chat.locator(".cave-bubble-user").last()).toContainText("Which auth? → Cookies");
});

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
