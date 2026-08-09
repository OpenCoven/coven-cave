import { expect, test, type Page } from "@playwright/test";

// Task Work cockpit fit: the conversation must fill the cockpit at any width,
// and the collapsed code rail must be a full-height strip on the RIGHT edge.
//
// Both regressions were structural, not cosmetic:
//   1. ChatView's root (.cave-chat-linear) carries no width of its own. The
//      cockpit body is a flex ROW, so as a direct flex child the whole chat
//      shrink-wrapped to its 64rem reading measure — on a 1900px cockpit the
//      thread, header actions and composer sat crammed in the left ~1090px
//      with ~800px of dead gutter beside them. A pre-existing stretch rule was
//      scoped to `.task-work-cockpit__group`, which the bridge-backed
//      first-send branch (`initialPrompt`) never renders.
//   2. .workspace-rail-reopen is written against a flex ROW (44px wide, full
//      height, in flow so it reserves its own width). The cockpit ROOT is a
//      flex COLUMN, so hosting it there docked it as a stub in the bottom-left
//      corner under the composer.
//
// Daemon-less like every spec here: onboarding dismissed, all routes mocked.

const ISO = "2026-06-12T10:00:00.000Z";
const WIDE = { width: 1900, height: 1000 };

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

const card = (over: Record<string, unknown>) => ({
  notes: "",
  status: "running",
  priority: "high",
  familiarId: "nova",
  sessionId: null,
  cwd: "/repo/alpha",
  links: [],
  github: [],
  asana: [],
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  lifecycle: "running",
  lifecycleAt: ISO,
  retryCount: 0,
  maxRetries: 3,
  steps: [],
  ...over,
});

const LINKED_CARD = card({
  id: "card-linked",
  title: "Linked task — resumes an existing work session",
  sessionId: "s-work",
});
const FRESH_CARD = card({ id: "card-fresh", title: "Fresh task — first send goes through the bridge" });

const WORK_SESSION = {
  id: "s-work",
  title: "Phase 1B: spoke protocol",
  status: "running",
  origin: "chat",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local",
  project_root: "/repo/alpha",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

async function openBoard(page: Page, cards: unknown[], sessions: unknown[]) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:code-rail:pinned:v1", "false");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions } }));
  await page.route("**/api/board", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { ok: true, cards } })
      : route.fulfill({ json: { ok: true, card: cards[0] } }),
  );
  // A repo-linked session makes the code rail AVAILABLE; zero changed files
  // keeps it collapsed, which is exactly when the reopen strip renders.
  await page.route("**/api/changes**", (route) => route.fulfill({ json: { ok: true, files: [] } }));
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: { turns: [{ id: "t1", role: "assistant", text: "On it.", createdAt: ISO }] },
        context: {},
      },
    }),
  );
  // The bridge-backed start: board POSTs here, then hands the first prompt to
  // ChatView through TaskWorkCockpit's `initialPrompt` branch.
  await page.route("**/api/board/*/chat", (route) =>
    route.fulfill({
      json: {
        ok: true,
        sessionId: "s-bridge",
        familiarId: "nova",
        bridge: "native-chat",
        initialPrompt: "Add the Coven stateless spoke protocol.",
        card: { ...FRESH_CARD, sessionId: "s-bridge" },
      },
    }),
  );
  await page.route("**/api/chat/send**", (route) => route.fulfill({ json: { ok: true } }));

  await page.setViewportSize(WIDE);
  // `#card-<id>` is the board's own deep link into a card drawer — steadier
  // than hunting the kanban tile by its title text.
  await page.goto(`/?mode=board#card-${(cards[0] as { id: string }).id}`);
  await page.waitForSelector(".board-shell", { timeout: 30_000 });
}

/** Take the open card drawer's Work action into the cockpit. */
async function openCockpit(page: Page, action: "Start work" | "linked") {
  await page.waitForSelector(".board-drawer-field", { timeout: 30_000 });
  if (action === "Start work") {
    await page.locator(".board-drawer-chat-cta").first().click();
  } else {
    await page.locator(".board-drawer-chat-card--linked").click();
  }
  await page.waitForSelector(".task-work-cockpit .cave-chat-linear", { timeout: 30_000 });
}

/** Geometry of the cockpit body row and the chat that should fill it. */
function fit(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    const box = (selector: string) => rect(document.querySelector(selector));
    const body = document.querySelector(".task-work-cockpit__body");
    const chat = document.querySelector(".task-work-cockpit .cave-chat-linear");
    // The rightmost edge anything in the body row reaches. Short of the body's
    // own right edge means a dead gutter — the exact regression under test.
    const rowRight = body
      ? Math.round(Math.max(...[...body.children].map((c) => c.getBoundingClientRect().right)))
      : null;
    return {
      body: rect(body),
      chat: rect(chat),
      // Whatever directly hosts the chat: the body row itself on the
      // bridge-start branch, the conversation Panel when a Group is mounted.
      chatHost: rect(chat?.parentElement),
      header: box(".task-work-cockpit__header"),
      reopen: box(".task-work-cockpit .workspace-rail-reopen"),
      rowRight,
    };
  });
}

test.describe("Task Work cockpit fit", () => {
  test("the bridge-backed first-send conversation fills the cockpit", async ({ page }) => {
    await openBoard(page, [FRESH_CARD], []);
    await openCockpit(page, "Start work");

    const { body, chat, chatHost, header, reopen, rowRight } = await fit(page);
    expect(body).not.toBeNull();
    expect(chat).not.toBeNull();
    // On this branch ChatView mounts straight into the body row.
    expect(chatHost!.width).toBe(body!.width);
    // The chat starts at the body's left edge and ends at the body's right edge
    // (minus the reopen strip, when it is showing). Before the fix the chat was
    // ~1090px inside a ~1900px body — a ~800px dead gutter.
    const reserved = reopen ? reopen.width : 0;
    expect(chat!.left).toBe(body!.left);
    expect(body!.width - chat!.width).toBe(reserved);
    // Nothing is left over on the right.
    expect(rowRight).toBe(body!.right);
    // And the conversation spans the same measure as the full-bleed header.
    expect(body!.width).toBe(header!.width);
  });

  test("the collapsed code rail is a full-height strip on the cockpit's right edge", async ({ page }) => {
    await openBoard(page, [FRESH_CARD], []);
    await openCockpit(page, "Start work");

    const { body, chat, reopen } = await fit(page);
    expect(reopen, "the repo-linked cockpit shows the collapsed code rail").not.toBeNull();
    // Right edge of the body, not the bottom-left corner.
    expect(reopen!.right).toBe(body!.right);
    expect(reopen!.top).toBe(body!.top);
    expect(reopen!.bottom).toBe(body!.bottom);
    // In flow: it reserves its own width, so the chat ends where it begins.
    expect(chat!.right).toBe(reopen!.left);
  });

  test("a resumed work session fills the cockpit too", async ({ page }) => {
    await openBoard(page, [LINKED_CARD], [WORK_SESSION]);
    await openCockpit(page, "linked");

    // A resumed session mounts the Group, and the cockpit auto-reopens the code
    // rail beside the conversation — so the chat fills its PANEL rather than the
    // whole row, and the row itself is still fully consumed.
    const { body, chat, chatHost, header, rowRight } = await fit(page);
    expect(chat!.left).toBe(chatHost!.left);
    expect(chat!.width).toBe(chatHost!.width);
    expect(chatHost!.left).toBe(body!.left);
    expect(rowRight).toBe(body!.right);
    expect(body!.width).toBe(header!.width);
  });

  test("the cockpit conversation still fills a narrow window", async ({ page }) => {
    await openBoard(page, [FRESH_CARD], []);
    await openCockpit(page, "Start work");
    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForTimeout(300);

    const { body, chat, reopen } = await fit(page);
    expect(chat!.left).toBe(body!.left);
    expect(chat!.right).toBe(reopen ? reopen.left : body!.right);
    // No horizontal overflow off the cockpit.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
