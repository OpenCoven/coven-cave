import { expect, test, type Page } from "@playwright/test";

/**
 * The earlier-turns fold (cave-u5lq7, "Chat Session - Prototype.dc.html").
 *
 * The fold's model has unit tests (src/lib/chat-transcript-fold.test.ts) and the
 * wiring has source-text pins, but neither can tell you the control actually
 * works — a source pin asserts that code LOOKS a certain way and goes stale the
 * moment something is renamed. cave-oqawv had to repair five such pins in one
 * night, none of which had ever caught a defect. These assertions are
 * behavioural on purpose.
 */

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

const SESSION_ID = "fold-e2e";
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

/** 7 exchanges = 14 turns = 14 groups. The fold keeps 6 groups, so 8 turns hide. */
const TURNS = Array.from({ length: 7 }).flatMap((_, i) => [
  {
    id: `u${i}`,
    parentId: i === 0 ? null : `a${i - 1}`,
    role: "user",
    text: `Question ${i + 1} about the worktree sweep.`,
    createdAt: iso(400 - i * 20),
  },
  {
    id: `a${i}`,
    parentId: `u${i}`,
    role: "assistant",
    text: `Answer ${i + 1}. Prose long enough to occupy a row in the reading column.`,
    createdAt: iso(399 - i * 20),
  },
]);

const SESSION = {
  id: SESSION_ID,
  project_root: "/repo",
  harness: "copilot",
  model: "github/gpt-5",
  title: "A thread long enough to fold",
  status: "completed",
  exit_code: null,
  archived_at: null,
  created_at: iso(420),
  updated_at: iso(1),
  familiarId: FAMILIAR.id,
  hasLocalConversation: true,
};

const foldPill = (page: Page) => page.locator(".cave-chat-fold__pill");
const turns = (page: Page) => page.locator("[data-turn-id]");

async function openFoldedThread(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "nova");
  });
  // CI runs daemon-less (COVEN_CAVE_E2E=1): every surface is driven from mocks.
  await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [FAMILIAR] } }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [SESSION] } }));
  await page.route("**/api/chat/conversation/**", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({
          json: {
            ok: true,
            conversation: { sessionId: SESSION_ID, familiarId: FAMILIAR.id, turns: TURNS, activeLeafId: "a6" },
            context: null,
          },
        })
      : r.fulfill({ json: { ok: true } }),
  );
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  // cave:agents-open-session is handled by ChatSurface, so the surface has to
  // be MOUNTED before the event is dispatched — the app boots on home, where
  // that listener does not exist yet and the event lands on nothing.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } })));
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.evaluate((id) =>
    window.dispatchEvent(
      new CustomEvent("cave:agents-open-session", { detail: { sessionId: id, familiarId: "nova" } }),
    ), SESSION_ID);
  await expect(turns(page).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("earlier-turns fold", () => {
  test("a long thread opens folded, names what it hides, and reveals every turn", async ({ page }) => {
    await openFoldedThread(page);

    // Closed: only the recent exchange is mounted, and the pill counts TURNS —
    // not groups. Counting groups would print "1 earlier turn" over a fold
    // hiding a whole voice call.
    const foldedCount = await turns(page).count();
    expect(foldedCount, "a closed fold mounts only the kept tail").toBeLessThan(TURNS.length);
    await expect(foldPill(page)).toHaveAttribute("aria-expanded", "false");
    await expect(foldPill(page)).toContainText(`${TURNS.length - foldedCount} earlier`);

    // The accessible name is a sentence, not the terse mono chrome.
    await expect(foldPill(page)).toHaveAttribute("aria-label", /^Show \d+ earlier turns?$/);

    // Open: every turn is reachable, and the label names the way back rather
    // than continuing to claim turns are hidden while they are on screen.
    await foldPill(page).click();
    await expect(foldPill(page)).toHaveAttribute("aria-expanded", "true");
    await expect(turns(page)).toHaveCount(TURNS.length);
    await expect(foldPill(page)).toContainText("hide earlier turns");
    await expect(foldPill(page)).toHaveAttribute("aria-label", "Hide earlier turns");

    // And it folds back, so the control is a toggle rather than a one-way door.
    await foldPill(page).click();
    await expect(foldPill(page)).toHaveAttribute("aria-expanded", "false");
    await expect(turns(page)).toHaveCount(foldedCount);
  });

  test("the caret inverts with the fold rather than pointing one way forever", async ({ page }) => {
    await openFoldedThread(page);
    const caret = page.locator(".cave-chat-fold__caret");

    // Closed the caret points DOWN (press to reveal); open it points UP (press
    // to fold away). This shipped broken once: the rotation was driven by a
    // data-prop on <Icon>, which forwards only aria-*/role, so the attribute
    // was dropped and the open pill read "hide earlier turns" beside a caret
    // still pointing down — the control contradicting its own label.
    // Poll rather than read once: the caret has a transform TRANSITION, so the
    // computed style still reports the previous value for a frame after
    // aria-expanded flips. Reading immediately caught the old matrix and made
    // a working caret look frozen.
    const transform = () => caret.evaluate((el) => getComputedStyle(el).transform);
    const ROTATED_180 = "matrix(-1, 0, 0, -1, 0, 0)";

    await expect
      .poll(transform, { message: "closed, the caret points down (press to reveal)" })
      .toBe(ROTATED_180);

    await foldPill(page).click();
    await expect(foldPill(page)).toHaveAttribute("aria-expanded", "true");

    // Open, the rotation is dropped entirely — the caret points up, at what the
    // press now does.
    await expect
      .poll(transform, { message: "open, the caret points up (press to fold away)" })
      .not.toBe(ROTATED_180);
  });

  test("opening find clears the fold so a hit in a hidden turn is reachable", async ({ page }) => {
    await openFoldedThread(page);
    await expect(foldPill(page)).toHaveAttribute("aria-expanded", "false");
    expect(await turns(page).count(), "starts folded").toBeLessThan(TURNS.length);

    // Find searches the WHOLE transcript and jumps by resolving [data-turn-id]
    // in the DOM. With the fold closed, a hit in a folded turn would be
    // reported and then jump nowhere, because that row was never rendered.
    // Find therefore has to clear the fold as well as the render cap.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");

    await expect(foldPill(page)).toHaveAttribute("aria-expanded", "true", { timeout: 10_000 });
    await expect(turns(page)).toHaveCount(TURNS.length);

    // The oldest turn — the one furthest behind the fold — is now addressable,
    // which is the property the jump depends on.
    await expect(page.locator('[data-turn-id="u0"]')).toHaveCount(1);
  });
});
