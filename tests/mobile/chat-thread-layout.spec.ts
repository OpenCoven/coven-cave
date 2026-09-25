import { expect, test, type Locator, type Page } from "@playwright/test";

// Phone chat layout contracts from the interface review (#5527). Each one was
// observed broken on origin/main 426f3d812 at 390×844:
//   - an opened thread scrolled onto 324px of reserved blank space;
//   - a wide code line, table or URL widened the reply past its column;
//   - the Tools tab sat on top of the Auto chip;
//   - the chat-list and right-panel toggles were under the 44px touch target.
// Lives under tests/mobile/ so the pixel-5 and iphone-13 projects run it.
// Daemon-less: onboarding dismissed, APIs mocked.

const ISO = "2026-09-23T07:00:00.000Z";
const SESSION_ID = "s-phone-layout";

const WIDE_REPLY = `Here is the plan.

\`\`\`ts
const reallyLongIdentifierThatShouldScrollHorizontallyInsideTheCodeBlockAndNotBreakThePageLayout = await reconcileServeRoutes();
\`\`\`

| Column A | Column B | Column C | Column D |
| --- | --- | --- | --- |
| a long cell value here | another long cell value | third | fourth value that is long |

See https://github.com/OpenCoven/coven-cave/pull/5465/files#diff-${"a".repeat(96)}

The last line of the reply is what the phone must show first.`;

function turns() {
  const out: Array<Record<string, unknown>> = [];
  let parentId: string | null = null;
  for (let index = 0; index < 4; index += 1) {
    const userId = `u-${index}`;
    const assistantId = `a-${index}`;
    out.push({ id: userId, parentId, role: "user", text: `Question ${index + 1}`, createdAt: ISO });
    out.push({
      id: assistantId,
      parentId: userId,
      role: "assistant",
      text: index === 3 ? WIDE_REPLY : `Answer ${index + 1}. ${"Context sentence. ".repeat(12)}`,
      createdAt: ISO,
    });
    parentId = assistantId;
  }
  return out;
}

async function openThread(page: Page) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1").hostname;
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: origin, path: "/" }]);
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        sessions: [
          {
            id: SESSION_ID,
            title: "Phone layout",
            status: "idle",
            project_root: "/tmp/coven-cave",
            harness: "claude",
            familiarId: "nova",
            model: "test",
            runtime: "local:/tmp/coven-cave",
            exit_code: null,
            archived_at: null,
            created_at: ISO,
            updated_at: ISO,
          },
        ],
      },
    }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({ json: { ok: true, conversation: { activeLeafId: "a-3", turns: turns() } } }),
  );
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  // Same entry as tests/mobile/code-rail-sheet.spec.ts: re-dispatch inside the
  // poll, because on a cold phone load the listener can attach after the frame.
  await page.waitForFunction(
    () => {
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
      return document.querySelector(".chat-surface") !== null;
    },
    undefined,
    { timeout: 25_000 },
  );
  // On phone the chat list is the landing view; open the thread as a user does.
  await page.locator(".chat-surface").getByRole("button", { name: /Phone layout/ }).first().click();
  await expect(page.getByText("The last line of the reply is what the phone must show first.")).toBeAttached({
    timeout: 30_000,
  });
}

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  expect(rect, "element has a layout box").not.toBeNull();
  return rect!;
}

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, "phone layout contract");
});

test("an opened thread lands on its last turn, not on reserved blank space", async ({ page }) => {
  await openThread(page);
  const transcript = page.locator(".cave-chat-linear .cave-chat-transcript");
  const lastTurn = transcript.locator(".cave-linear-turn").last();
  // The chrome budget (#5527 finding 5) can leave a short transcript, so the
  // contract is about what fills its bottom edge: the last turn, not a
  // composer-sized gap the dock never occupies.
  await expect(async () => {
    const view = await box(transcript);
    const turn = await box(lastTurn);
    expect(turn.y + turn.height, "last turn reaches into view").toBeGreaterThan(view.y);
    const blankBelow = view.y + view.height - (turn.y + turn.height);
    expect(blankBelow, "blank space under the last turn").toBeLessThanOrEqual(64);
  }).toPass({ timeout: 10_000 });
});

test("wide code, tables and URLs scroll inside the reply instead of widening it", async ({ page }) => {
  await openThread(page);
  const reply = page.locator(".cave-bubble-assistant").last();
  const prose = reply.locator(".streaming-turn-prose .cave-md").first();
  await expect(prose).toBeVisible();
  const column = await box(reply);
  const md = await box(prose);
  expect(md.x + md.width).toBeLessThanOrEqual(column.x + column.width + 1);

  const code = reply.locator("pre").first();
  // Measure after layout settles: a web font swap can re-lay out the block.
  await expect
    .poll(() => code.evaluate((element) => element.scrollWidth > element.clientWidth), {
      message: "the long code line scrolls inside its own block",
    })
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("at rest the action strip folds into Tools; with the keyboard up it clears the Tools tab", async ({ page }) => {
  await openThread(page);
  const chat = page.locator(".cave-chat-linear");
  const strip = chat.locator(".cave-mobile-action-strip");
  const tools = chat.locator(".cave-composer-tools-tab").first();
  // #5529: at rest the strip is folded; its actions are listed first in Tools.
  await expect(strip).toBeHidden();
  await tools.click();
  const menu = page.getByRole("menu", { name: "Tools" });
  await expect(menu.getByRole("menuitemcheckbox", { name: "Select Auto mode" })).toBeVisible();
  for (const name of ["Retry last message", "Summarize session", "Start voice call"]) {
    await expect(menu.getByRole("menuitem", { name })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // ChatView sets data-keyboard-open from the visual viewport, which a desktop
  // browser can't shrink; set the same attribute to check the layout it gates.
  await chat.evaluate((section) => section.setAttribute("data-keyboard-open", "true"));
  const auto = strip.locator(".cave-mobile-action-chip--auto");
  await expect(auto).toBeVisible();
  const a = await box(tools);
  const b = await box(auto);
  const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps, `Tools ${JSON.stringify(a)} vs Auto ${JSON.stringify(b)}`).toBe(false);
});

test("phone chat toggles meet the 44px touch target", async ({ page }) => {
  await openThread(page);
  // #5529: with a thread open the chat-list toggle lives in the chat header.
  for (const selector of [".cave-mobile-header-threads", ".shell-top > .shell-top-toggle--right"]) {
    const toggle = page.locator(selector).first();
    await expect(toggle, selector).toBeVisible();
    const rect = await box(toggle);
    expect(rect.width, `${selector} width`).toBeGreaterThanOrEqual(44);
    expect(rect.height, `${selector} height`).toBeGreaterThanOrEqual(44);
  }
});

// With the chrome folds (#5529) and the two-line composer (#5548): 52.0% on
// iPhone 13 (664px) and 56.3% on Pixel 5 (727px), up from 40.4% and 45.6%
// with the four-row, 206px composer panel (now 129px).
const TRANSCRIPT_FLOOR = 0.5;

test("an open thread folds the phone chrome so the transcript gets the height", async ({ page }, testInfo) => {
  // A running daemon, so no status banner takes height the chrome doesn't own.
  await page.route("**/api/daemon/connection**", (route) =>
    route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }),
  );
  await openThread(page);
  const chat = page.locator(".chat-surface");
  // The familiar row, the section tabs strip and the action strip are folded;
  // the familiar picker stays in the top bar and the tabs in the chat-list sheet.
  await expect(chat.locator(".chat-familiar-context")).toBeHidden();
  await expect(chat.locator(".chat-scope-tabs")).toBeHidden();
  await expect(chat.locator(".cave-mobile-action-strip")).toBeHidden();
  await expect(page.getByRole("button", { name: "Show chat list" })).toBeVisible();

  const transcript = await box(page.locator(".cave-chat-linear .cave-chat-transcript"));
  const viewportHeight = page.viewportSize()!.height;
  const share = transcript.height / viewportHeight;
  testInfo.annotations.push({ type: "transcript", description: `${Math.round(transcript.height)}px of ${viewportHeight}px (${(share * 100).toFixed(1)}%)` });
  expect(share, "transcript share of the viewport").toBeGreaterThanOrEqual(TRANSCRIPT_FLOOR);
});

test("at 390×844 the transcript gets at least half the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/daemon/connection**", (route) =>
    route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }),
  );
  await openThread(page);
  const transcript = await box(page.locator(".cave-chat-linear .cave-chat-transcript"));
  expect(transcript.height / 844, `transcript ${Math.round(transcript.height)}px of 844px`).toBeGreaterThanOrEqual(0.5);
});

test("the phone composer is two lines: message with mic and send, then chips with enhance", async ({ page }) => {
  await page.route("**/api/daemon/connection**", (route) =>
    route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }),
  );
  await openThread(page);
  const composer = page.locator(".cave-chat-linear .cave-composer-panel");
  const input = await box(composer.locator(".cave-composer-input-wrap"));
  const mic = await box(composer.getByRole("button", { name: "Voice call" }));
  const send = await box(composer.getByRole("button", { name: "Send message" }));
  const chips = await box(composer.locator(".cave-composer-footer-band"));
  const enhance = await box(composer.locator(".composer-enhance-control"));
  const middle = (rect: { y: number; height: number }) => rect.y + rect.height / 2;

  // Mic and send share the message line; chips and enhance share the next.
  for (const [name, rect] of [["mic", mic], ["send", send]] as const) {
    expect(Math.abs(middle(rect) - middle(input)), `${name} sits on the message line`).toBeLessThanOrEqual(8);
    expect(rect.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(rect.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }
  expect(chips.y, "chips sit below the message line").toBeGreaterThanOrEqual(input.y + input.height - 1);
  expect(Math.abs(middle(enhance) - middle(chips)), "enhance shares the chips line").toBeLessThanOrEqual(8);
  expect(input.width, "the message field keeps a usable width").toBeGreaterThanOrEqual(200);

  // The chips keep room for their names instead of truncating to "Cho…".
  const labels = await composer.locator(".cave-composer-footer-band .cave-context-chip").evaluateAll((chips) =>
    chips.flatMap((chip) =>
      [...chip.querySelectorAll("span")]
        .filter((span) => span.textContent?.trim() && !span.querySelector("span"))
        .map((span) => ({ text: span.textContent!.trim(), clipped: span.scrollWidth > span.clientWidth + 1 })),
    ),
  );
  expect(labels.length, "the chips' labels were measured").toBeGreaterThanOrEqual(2);
  expect(labels.filter((label) => label.clipped).map((label) => label.text), "no chip label is truncated").toEqual([]);
});
