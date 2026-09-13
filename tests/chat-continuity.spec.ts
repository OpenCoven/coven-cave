import { expect, test, type Page } from "@playwright/test";
import type { ConversationHistoryTurn } from "../src/lib/chat-turn-state";

const familiars = [
  { id: "nova", display_name: "Nova", role: "Orchestrator", icon: "ph:sparkle-fill", status: "active" },
  { id: "sage", display_name: "Sage", role: "Researcher", icon: "ph:book-open", status: "active" },
];
const turns = Array.from({ length: 16 }, (_, i) => ({
  id: `turn-${i}`,
  parentId: i === 0 ? null : `turn-${i - 1}`,
  role: i % 2 === 0 ? "user" : "assistant",
  text: i % 2 === 0
    ? `Chapter ${Math.floor(i / 4) + 1}: keep the original chat and its exact messages.`
    : "The familiar stays with this conversation. Date chapters help you return to the work without combining other chats.",
  createdAt: `2026-09-${String(6 + Math.floor(i / 4)).padStart(2, "0")}T12:00:00Z`,
}));
const sessions = [
  { id: "continuity-exact", familiarId: "nova", title: "Familiar continuity · design notes" },
  { id: "continuity-other", familiarId: "nova", title: "Separate conversation" },
  { id: "sage-exact", familiarId: "sage", title: "Sage’s research" },
].map((session) => ({
  ...session, project_root: "/repo", harness: "copilot", status: "completed", model: "github/gpt-5",
  exit_code: null, archived_at: null, hasLocalConversation: true,
  attention: { state: "none", since: null, reason: null },
  created_at: "2026-09-06T12:00:00Z", updated_at: "2026-09-09T12:00:00Z",
}));

async function fixture(
  page: Page,
  enabled = true,
  invalidDates: false | "empty" | "missing" | "duplicate" = false,
  history?: { turns: ConversationHistoryTurn[]; activeLeafId?: string },
) {
  await page.addInitScript(({ enabled }) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    if (enabled) localStorage.setItem("cave.chat.continuity.enabled.v1", "true");
    for (const [familiarId, conversationId] of [["nova", "continuity-exact"], ["sage", "sage-exact"]]) {
      localStorage.setItem(`cave.chat.continuity.return.v1:${JSON.stringify([location.origin, familiarId])}`,
        JSON.stringify({ sourceId: location.origin, familiarId, conversationId, anchorId: null }));
    }
  }, { enabled });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "continuity-project", name: "Continuity project", root: "/repo", access: "write" }],
  } }));
  await page.route("**/api/chat/conversation/**", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    return route.fulfill({ json: { ok: true, conversation: {
      sessionId: id, familiarId: sessions.find((s) => s.id === id)?.familiarId,
      turns: id === "continuity-exact"
        ? [...(history?.turns ?? turns).map((turn) => invalidDates === "empty" ? { ...turn, createdAt: "" }
          : invalidDates === "missing" ? { ...turn, createdAt: undefined }
          : invalidDates === "duplicate" ? { ...turn, id: "duplicate" } : turn),
          ...(history ? [] : [{ id: "inactive-branch", parentId: "turn-0", role: "assistant", text: "Inactive sibling must not become a chapter.", createdAt: "2026-08-01T12:00:00Z" }])]
        : [{ id: "separate-turn", parentId: null, role: "assistant", text: id === "sage-exact" ? "Sage’s exact chat." : "This is a separate chat.", createdAt: "2026-09-09T12:00:00Z" }],
      activeLeafId: id === "continuity-exact" ? (history ? history.activeLeafId : "turn-15") : "separate-turn",
    }, context: null } });
  });
}

async function chat(page: Page, hash = "") {
  await page.goto(`/${hash}`);
  await page.waitForSelector(".shell-frame", { timeout: 60_000 });
  await page.waitForFunction(() => {
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
    return Boolean(document.querySelector(".chat-surface"));
  }, undefined, { timeout: 60_000 });
}

async function openExact(page: Page, sessionId: string, familiarId = "nova") {
  await page.evaluate(({ sessionId, familiarId }) => {
    window.dispatchEvent(new CustomEvent("cave:agents-open-session", { detail: { sessionId, familiarId } }));
  }, { sessionId, familiarId });
}

test("opt-in production chapters reveal exact folded turns, preserve branch and send target", async ({ page }) => {
  await fixture(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/chat/conversation/") && request.method() !== "GET") writes.push(request.url());
  });
  const sends: Record<string, unknown>[] = [];
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"done"}\n\n' });
  });
  await chat(page);
  await expect(page.getByRole("button", { name: "Browse chapters" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Browse chapters" }).click();
  const dialog = page.getByRole("dialog", { name: "This chat Chapters" });
  await expect(dialog).toContainText("Partial index");
  await expect(dialog.locator("[data-chapter-id]")).toHaveCount(4);
  await expect(dialog).not.toContainText("2026-08-01");
  await dialog.getByRole("button", { name: "2026-09-06 4 turns · UTC" }).click();
  const first = page.locator('[data-turn-id="turn-0"]');
  await expect(first).toBeFocused();
  await expect(first).toContainText(turns[0].text);
  await expect(page.locator("[data-turn-id]")).toHaveCount(16);
  await expect(page).toHaveURL(/#chat-continuity-exact$/);
  const reference = await page.evaluate(() => JSON.parse(localStorage.getItem(`cave.chat.continuity.return.v1:${JSON.stringify([location.origin, "nova"])}`)!));
  expect(Object.keys(reference).sort()).toEqual(["anchorId", "conversationId", "familiarId", "sourceId"]);
  expect(reference.anchorId).toBe(JSON.stringify(["utc-day-v1", "continuity-exact", "turn-0"]));
  await page.getByRole("button", { name: "Browse chapters" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Browse chapters" })).toBeFocused();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  const composer = page.locator(".chat-surface .cave-composer-input");
  await composer.fill("Continue in this exact chat.");
  await expect(composer).toHaveValue("Continue in this exact chat.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].sessionId).toBe("continuity-exact");
  expect(sends[0].familiarId).toBe("nova");
  // Ordinary sends keep the server's unchanged active leaf; browsing must
  // neither PATCH that leaf nor turn the next send into an explicit branch.
  expect(sends[0]).not.toHaveProperty("parentTurnId");
});

test("disabled mode keeps the transcript and has no chapter controls; explicit deep link wins", async ({ page }) => {
  await fixture(page, false);
  await chat(page);
  await openExact(page, "continuity-exact");
  await expect(page.locator('[data-turn-id="turn-15"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Browse chapters" })).toHaveCount(0);
  await page.getByRole("button", { name: "Chat preferences", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Familiar continuity" }).click();
  await expect(page.getByRole("button", { name: "Browse chapters" })).toBeVisible();
  await page.goto("/#chat-continuity-other");
  await expect(page.locator('[data-turn-id="separate-turn"]')).toContainText("This is a separate chat.", { timeout: 60_000 });
  await expect(page).toHaveURL(/#chat-continuity-other$/);
});

const systemHistory: ConversationHistoryTurn[] = [
  { id: "reply", parentId: "system", role: "assistant", text: "Original assistant reply", createdAt: "2026-09-08T12:00:00Z" },
  { id: "echo", parentId: null, role: "system", text: "Persisted orphan echo", createdAt: "2026-09-07T13:00:00Z" },
  { id: "system", parentId: "user", role: "system", text: "Persisted system ancestor", createdAt: "2026-09-07T12:00:00Z" },
  { id: "user", parentId: null, role: "user", text: "Original user request", createdAt: "2026-09-06T12:00:00Z" },
];

test("continuity toggle reprojects system lineage and echoes without draft, leaf or send mutation", async ({ page }) => {
  await fixture(page, false, false, { turns: systemHistory, activeLeafId: "reply" });
  const writes: string[] = [];
  let historyReads = 0;
  page.on("request", (request) => {
    if (!request.url().includes("/api/chat/conversation/continuity-exact")) return;
    if (request.method() === "GET") historyReads += 1;
    else writes.push(request.url());
  });
  const sends: Record<string, unknown>[] = [];
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"done"}\n\n' });
  });
  await chat(page);
  await openExact(page, "continuity-exact");
  await expect(page.locator('[data-turn-id="reply"]')).toContainText("Original assistant reply", { timeout: 60_000 });
  await expect(page.locator('[data-turn-id="system"]')).toHaveCount(0);
  const composer = page.locator(".chat-surface .cave-composer-input");
  await composer.fill("Keep this draft and exact chat.");
  const readsBeforeToggle = historyReads;
  const toggle = async () => {
    await page.getByRole("button", { name: "Chat preferences", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "Familiar continuity" }).click();
  };
  await toggle();
  await expect(composer).toHaveValue("Keep this draft and exact chat.");
  await page.getByRole("button", { name: "Browse chapters" }).click();
  const dialog = page.getByRole("dialog", { name: "This chat Chapters" });
  await expect(dialog.locator("[data-chapter-id]")).toHaveCount(3);
  await dialog.getByRole("button", { name: "2026-09-07 2 turns · UTC" }).click();
  await expect(page.locator('[data-turn-id="system"]')).toBeFocused();
  await expect(page.locator('[data-turn-id="system"]')).toContainText("Persisted system ancestor");
  expect(await page.locator(".chat-surface [data-turn-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-turn-id"))))
    .toEqual(["user", "system", "echo", "reply"]);
  await toggle();
  await expect(page.locator('[data-turn-id="system"]')).toHaveCount(0);
  await expect(page.locator('[data-turn-id="echo"]')).toHaveCount(0);
  await expect(page.locator('[data-turn-id="reply"]')).toBeVisible();
  await toggle();
  await expect(page.locator('[data-turn-id="system"]')).toBeVisible();
  await expect(page).toHaveURL(/#chat-continuity-exact$/);
  expect(historyReads).toBe(readsBeforeToggle);
  expect(writes).toEqual([]);
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("Keep this draft and exact chat.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].sessionId).toBe("continuity-exact");
  expect(sends[0].familiarId).toBe("nova");
  expect(sends[0]).not.toHaveProperty("parentTurnId");
  await openExact(page, "continuity-other");
  await expect(page.locator('[data-turn-id="separate-turn"]')).toBeVisible();
  await expect(page.locator('[data-turn-id="system"]')).toHaveCount(0);
});

for (const corruption of ["missing", "cyclic"] as const) test(`${corruption} system lineage keeps transcript accessible but chapter index unavailable`, async ({ page }) => {
  const broken = systemHistory.map((turn) => turn.id === "system"
    ? { ...turn, parentId: corruption === "missing" ? "removed" : "reply" }
    : turn);
  await fixture(page, true, false, { turns: broken, activeLeafId: "reply" });
  await chat(page);
  await expect(page.locator('[data-turn-id="reply"]')).toContainText("Original assistant reply", { timeout: 60_000 });
  await page.getByRole("button", { name: "Chapter index unavailable" }).click();
  const dialog = page.getByRole("dialog", { name: "This chat Chapters" });
  await expect(dialog).toContainText("Keep reading the transcript");
  await expect(dialog.locator("[data-chapter-id]")).toHaveCount(0);
});

test("persisted system-only history remains readable and clear does not resurrect its projection", async ({ page }) => {
  await fixture(page, true, false, {
    turns: [{ id: "only-echo", parentId: null, role: "system", text: "Original persisted echo", createdAt: "2026-09-07T12:00:00Z" }],
    activeLeafId: "",
  });
  await chat(page);
  await expect(page.locator('[data-turn-id="only-echo"]')).toContainText("Original persisted echo", { timeout: 60_000 });
  await page.getByRole("button", { name: "Browse chapters" }).click();
  await page.getByRole("button", { name: "2026-09-07 1 turn · UTC" }).click();
  await expect(page.locator('[data-turn-id="only-echo"]')).toBeFocused();
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await page.locator(".chat-surface .cave-composer-input").fill("/clear");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator('[data-turn-id="only-echo"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chapter index unavailable" })).toBeVisible();
});

for (const invalidDates of ["empty", "missing"] as const) test(`${invalidDates} dates leave transcript available and expose unavailable index`, async ({ page }) => {
  await fixture(page, true, invalidDates);
  await chat(page);
  await expect(page.getByRole("button", { name: "Chapter index unavailable" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-turn-id="turn-15"]')).toBeVisible();
  await page.getByRole("button", { name: "Chapter index unavailable" }).click();
  await expect(page.getByRole("dialog")).toContainText("Keep reading the transcript");
});

test("familiar switches restore exact chat and anchor; removed anchor never opens another turn", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await chat(page);
  await page.getByRole("button", { name: "Browse chapters" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "2026-09-06 4 turns · UTC" }).click();
  await expect(page.locator('[data-turn-id="turn-0"]')).toBeFocused();
  const switchFamiliar = async (name: string) => {
    await page.locator(".chat-familiar-context .familiar-switcher__trigger").click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
  };
  await switchFamiliar("Sage");
  await expect(page).toHaveURL(/#chat-sage-exact$/);
  await expect(page.locator('[data-turn-id="separate-turn"]')).toContainText("Sage’s exact chat.");
  await switchFamiliar("Nova");
  await expect(page).toHaveURL(/#chat-continuity-exact$/);
  await expect(page.locator('[data-turn-id="turn-0"]')).toBeFocused();
  await switchFamiliar("Sage");
  await page.evaluate(() => {
    const key = `cave.chat.continuity.return.v1:${JSON.stringify([location.origin, "nova"])}`;
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.anchorId = JSON.stringify(["utc-day-v1", "continuity-exact", "removed-turn"]);
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await switchFamiliar("Nova");
  await expect(page).toHaveURL(/#chat-continuity-exact$/);
  const notice = page.getByRole("status").filter({ hasText: "Saved location unavailable in the current history." });
  await expect(notice).toHaveText("Saved location unavailable in the current history. You're still in the same chat.");
  await expect(page.locator('[data-turn-id="turn-15"]')).toBeVisible();
  await expect(page.locator(".cave-turn-found")).toHaveCount(0);
  await page.getByRole("button", { name: "Browse chapters" }).click();
  await expect(page.getByRole("dialog").locator('[aria-current="location"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Browse chapters" }).click();
  await page.getByRole("button", { name: "2026-09-07 4 turns · UTC" }).click();
  await expect(page.locator('[data-turn-id="turn-4"]')).toBeFocused();
  await expect(notice).toHaveCount(0);
});

test("selected anchor unavailable on another branch stays reported until explicit valid selection", async ({ page }) => {
  await fixture(page, true, false, {
    turns: [
      { id: "root", parentId: null, role: "user", text: "Original request", createdAt: "2026-09-06T12:00:00Z" },
      { id: "reply-a", parentId: "root", role: "assistant", text: "First reply", createdAt: "2026-09-07T12:00:00Z" },
      { id: "reply-b", parentId: "root", role: "assistant", text: "Second reply", createdAt: "2026-09-09T12:00:00Z" },
    ],
    activeLeafId: "reply-a",
  });
  await chat(page);
  await page.getByRole("button", { name: "Browse chapters" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "2026-09-07 1 turn · UTC" }).click();
  await expect(page.locator('[data-turn-id="reply-a"]')).toBeFocused();
  await page.locator('[data-turn-id="reply-a"]').getByRole("button", { name: "Next response", exact: true }).click();
  const notice = page.getByRole("status").filter({ hasText: "Saved location unavailable in the current history." });
  await expect(notice).toBeVisible();
  await expect(page).toHaveURL(/#chat-continuity-exact$/);
  await expect(page.locator('[data-turn-id="reply-b"]')).toContainText("Second reply");
  await expect(page.locator(".cave-turn-found")).toHaveCount(0);
  await page.getByRole("button", { name: "Browse chapters" }).click();
  await expect(page.getByRole("dialog").locator('[aria-current="location"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(notice).toBeVisible();
  await page.locator('[data-turn-id="reply-b"]').getByRole("button", { name: "Previous response", exact: true }).click();
  await expect(page.locator('[data-turn-id="reply-a"]')).toContainText("First reply");
  await expect(notice).toBeVisible();
  await expect(page.locator(".cave-turn-found")).toHaveCount(0);
  await page.getByRole("button", { name: "Browse chapters" }).click();
  await page.getByRole("button", { name: "2026-09-07 1 turn · UTC" }).click();
  await expect(page.locator('[data-turn-id="reply-a"]')).toBeFocused();
  await expect(notice).toHaveCount(0);
});

test("saved anchor failure on unavailable index preserves reference and clears only with chat context", async ({ page }) => {
  await fixture(page, true, "missing");
  await page.setViewportSize({ width: 390, height: 844 });
  await chat(page);
  await expect(page.getByRole("button", { name: "Chapter index unavailable" })).toBeVisible({ timeout: 60_000 });
  const anchorId = JSON.stringify(["utc-day-v1", "continuity-exact", "turn-0"]);
  await page.evaluate((anchorId) => {
    const key = `cave.chat.continuity.return.v1:${JSON.stringify([location.origin, "nova"])}`;
    const saved = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...saved, anchorId }));
  }, anchorId);
  const switchFamiliar = async (name: string) => {
    await page.locator(".chat-familiar-context .familiar-switcher__trigger").click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
  };
  await switchFamiliar("Sage");
  await expect(page.locator('[data-turn-id="separate-turn"]')).toBeVisible();
  await switchFamiliar("Nova");
  const notice = page.getByRole("status").filter({ hasText: "Saved location unavailable in the current history." });
  await expect(notice).toHaveText("Saved location unavailable in the current history. You're still in the same chat.");
  await expect(page).toHaveURL(/#chat-continuity-exact$/);
  await expect(page.locator(".cave-turn-found")).toHaveCount(0);
  const savedAnchorId = await page.evaluate(() => JSON.parse(localStorage.getItem(
    `cave.chat.continuity.return.v1:${JSON.stringify([location.origin, "nova"])}`,
  )!).anchorId);
  expect(savedAnchorId).toBe(anchorId);
  await page.getByRole("button", { name: "Chapter index unavailable" }).click();
  await expect(page.getByRole("dialog").locator("[data-chapter-id]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(notice).toBeVisible();
  await openExact(page, "continuity-other");
  await expect(page.locator('[data-turn-id="separate-turn"]')).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test("production route wide and narrow chapter evidence", async ({ page }) => {
  test.skip(!process.env.CONTINUITY_SCREENSHOT_DIR, "Visual evidence is opt-in and stays outside the repository.");
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await chat(page);
  await page.getByRole("button", { name: "Browse chapters" }).click({ timeout: 60_000 });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: `${process.env.CONTINUITY_SCREENSHOT_DIR}/2026-09-09-continuity-cave-p1.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Browse chapters" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: `${process.env.CONTINUITY_SCREENSHOT_DIR}/2026-09-09-continuity-cave-p1-narrow.png`, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dark = await page.getByRole("dialog").evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.evaluate(() => {
    document.documentElement.dataset.mode = "light";
    document.documentElement.dataset.theme = "tide";
  });
  await expect.poll(() => page.getByRole("dialog").evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(dark);
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.getByRole("dialog").evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
});

for (const linked of [true, false]) test(`absent active leaf ${linked ? "leaves sibling history readable but index unavailable" : "indexes unlinked legacy history in source order"}`, async ({ page }) => {
  const raw: ConversationHistoryTurn[] = [
    { id: "root", parentId: null, role: "user", text: "Original root", createdAt: "2026-09-09T12:00:00Z" },
    { id: "childA", parentId: linked ? "root" : undefined, role: "assistant", text: "Original child A", createdAt: "2026-09-08T12:00:00Z" },
    { id: "childB", parentId: linked ? "root" : null, role: "assistant", text: "Original child B", createdAt: "2026-09-07T12:00:00Z" },
  ];
  await fixture(page, true, false, { turns: raw });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/chat/conversation/") && request.method() !== "GET") writes.push(request.url());
  });
  const response = page.waitForResponse((response) => response.url().endsWith("/api/chat/conversation/continuity-exact"));
  await chat(page);
  expect((await (await response).json()).conversation).not.toHaveProperty("activeLeafId");
  const rows = page.locator(".chat-surface [data-turn-id]");
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-turn-id")))).toEqual(["root", "childA", "childB"]);
  for (const turn of raw) await expect(page.locator(`[data-turn-id="${turn.id}"]`)).toContainText(turn.text);
  const composer = page.locator(".chat-surface .cave-composer-input");
  await composer.fill("Keep this exact-chat draft.");
  await page.getByRole("button", { name: linked ? "Chapter index unavailable" : "Browse chapters", exact: true }).click();
  const chapters = page.getByRole("dialog").locator("[data-chapter-id]");
  await expect(chapters).toHaveCount(linked ? 0 : 3);
  if (linked) {
    await expect(page.getByRole("dialog")).toContainText("Chapter index unavailable");
    await page.keyboard.press("Escape");
    await expect(page.locator(".cave-turn-found")).toHaveCount(0);
  } else {
    await expect(page.getByRole("dialog")).toContainText("Partial index");
    expect(await chapters.locator("time").allTextContents()).toEqual(["2026-09-09", "2026-09-08", "2026-09-07"]);
    await chapters.nth(1).click();
    await expect(page.locator('[data-turn-id="childA"]')).toBeFocused();
  }
  await expect(rows).toHaveCount(3);
  await expect(composer).toHaveValue("Keep this exact-chat draft.");
  await expect(page).toHaveURL(/#chat-continuity-exact$/);
  expect(writes).toEqual([]);
});

test("100k source turns stay within 60 mounted rows through old chapters, paging, streaming and latest", async ({ page }) => {
  test.setTimeout(180_000);
  const large = Array.from({ length: 100_000 }, (_, i) => ({
    id: `large-${i}`, parentId: i === 0 ? null : `large-${i - 1}`,
    role: i % 2 === 0 ? "user" : "assistant", text: `Original turn ${i}`,
    createdAt: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 1000))).toISOString(),
    voiceCallId: "one-large-persisted-call",
  }));
  await fixture(page, true, false, { turns: large, activeLeafId: "large-99999" });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/chat/send")) return originalFetch(input, init);
      document.documentElement.dataset.continuitySend = String(init?.body);
      const encoder = new TextEncoder();
      let receive: ((event: Event) => void) | undefined;
      return new Response(new ReadableStream({
        start(controller) {
          receive = (event) => {
            if (!(event instanceof CustomEvent)) return;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.detail)}\n\n`));
            if (event.detail.kind === "done") {
              window.removeEventListener("continuity:e2e-stream", receive!);
              controller.close();
            }
          };
          window.addEventListener("continuity:e2e-stream", receive);
        },
        cancel() {
          if (receive) window.removeEventListener("continuity:e2e-stream", receive);
        },
      }), { headers: { "content-type": "text/event-stream" } });
    };
    new MutationObserver(() => {
      const count = document.querySelectorAll(".chat-surface [data-turn-id]").length;
      const previous = Number(document.documentElement.dataset.continuityMaxMounted ?? 0);
      if (count > previous) document.documentElement.dataset.continuityMaxMounted = String(count);
    }).observe(document, { childList: true, subtree: true });
  });
  await chat(page);
  const rows = page.locator(".chat-surface [data-turn-id]");
  const controls = page.getByRole("navigation", { name: "Loaded transcript window" });
  await expect(controls).toContainText("Turns 99941–100000 of 100000 loaded", { timeout: 90_000 });
  await expect(rows).toHaveCount(60);
  await expect(page.locator('[data-turn-id="large-99999"]')).toBeVisible();
  const select = async (date: string) => {
    await page.getByRole("button", { name: "Browse chapters" }).click();
    await page.getByRole("button", { name: `${date} 1000 turns · UTC`, exact: true }).click();
  };
  await select("2026-01-01");
  await expect(page.locator('[data-turn-id="large-0"]')).toBeFocused();
  await expect(rows).toHaveCount(60);
  await select("2026-01-02");
  await expect(page.locator('[data-turn-id="large-1000"]')).toBeFocused();
  await expect(controls).toContainText("Turns 971–1030 of 100000 loaded");
  await controls.getByRole("button", { name: "Earlier turns", exact: true }).click();
  await expect(page.locator('[data-turn-id="large-910"]')).toBeFocused();
  await controls.getByRole("button", { name: "Later turns", exact: true }).click();
  await expect(page.locator('[data-turn-id="large-970"]')).toBeFocused();
  await page.getByRole("button", { name: "Find in conversation", exact: true }).click();
  const findInput = page.getByPlaceholder("Find in chat…");
  await findInput.fill("Original turn 12340");
  await expect(page.locator('[data-turn-id="large-12340"].cave-turn-found')).toBeVisible();
  await expect(findInput).toBeFocused();
  await expect(rows).toHaveCount(60);
  await page.getByRole("button", { name: "Close find", exact: true }).click();
  await controls.getByRole("button", { name: "Return to latest", exact: true }).click();
  await expect(page.locator('[data-turn-id="large-99999"]')).toBeVisible();
  await page.locator(".chat-surface .cave-composer-input").fill("Continue this exact conversation.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-continuity-send")).not.toBeNull();
  const send = JSON.parse((await page.locator("html").getAttribute("data-continuity-send"))!);
  expect(send.sessionId).toBe("continuity-exact");
  expect(send.familiarId).toBe("nova");
  expect(send).not.toHaveProperty("parentTurnId");
  await select("2026-01-01");
  const first = page.locator('[data-turn-id="large-0"]');
  await expect(first).toBeFocused();
  const top = () => first.evaluate((row) => row.getBoundingClientRect().top - row.closest(".cave-chat-transcript")!.getBoundingClientRect().top);
  const before = await top();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("continuity:e2e-stream", {
    detail: { kind: "assistant_chunk", text: "A new streamed reply at the latest execution context." },
  })));
  await expect(page.getByRole("button", { name: "New response content", exact: true })).toBeVisible();
  await expect(controls).toContainText("Turns 1–60 of 100002 loaded");
  await expect(rows).toHaveCount(60);
  await expect(first).toBeFocused();
  await expect.poll(async () => Math.abs((await top()) - before)).toBeLessThan(3);
  await page.getByRole("button", { name: "New response content", exact: true }).click();
  await expect(page.getByText("A new streamed reply at the latest execution context.", { exact: true })).toBeVisible();
  await expect(controls).toContainText("Turns 99943–100002 of 100002 loaded");
  await expect(rows).toHaveCount(60);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("continuity:e2e-stream", { detail: { kind: "done" } })));
  await expect(page.locator("html")).toHaveAttribute("data-continuity-max-mounted", "60");
});
