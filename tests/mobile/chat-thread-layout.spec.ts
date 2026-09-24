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
  const scrolls = await code.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(scrolls, "the long code line scrolls inside its own block").toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the Tools tab does not sit on the Auto chip", async ({ page }) => {
  await openThread(page);
  const tools = page.locator(".cave-chat-linear .cave-composer-tools-tab").first();
  const auto = page.locator(".cave-chat-linear .cave-mobile-action-chip--auto").first();
  await expect(tools).toBeVisible();
  await expect(auto).toBeVisible();
  const a = await box(tools);
  const b = await box(auto);
  const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps, `Tools ${JSON.stringify(a)} vs Auto ${JSON.stringify(b)}`).toBe(false);
});

test("phone chat toggles meet the 44px touch target", async ({ page }) => {
  await openThread(page);
  for (const selector of [".mobile-threads-toggle", ".shell-top > .shell-top-toggle--right"]) {
    const toggle = page.locator(selector).first();
    await expect(toggle, selector).toBeVisible();
    const rect = await box(toggle);
    expect(rect.width, `${selector} width`).toBeGreaterThanOrEqual(44);
    expect(rect.height, `${selector} height`).toBeGreaterThanOrEqual(44);
  }
});
