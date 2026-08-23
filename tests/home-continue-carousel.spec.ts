import { expect, test, type Page } from "@playwright/test";

/**
 * Home's "Continue where you left off" carousel (cave-9oi1s).
 *
 * The strip used to render `sessions.slice(0, 3)` and drop the rest. It now
 * pages through every resumable session three at a time. What only a real
 * browser can prove — and what this file asserts — is the half the unit tests
 * cannot reach: where `document.activeElement` actually lands across a page
 * turn, whether the focus ring actually paints, and whether the page-turn
 * animation is really off under `prefers-reduced-motion`.
 *
 * Daemon-less: familiars, sessions and the board are `page.route` mocks.
 */

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
  harness: "claude",
};

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** Nine resumable sessions: three full carousel pages, newest first. */
const SESSIONS = Array.from({ length: 9 }, (_, i) => ({
  id: `s-${i + 1}`,
  project_root: process.cwd(),
  harness: "claude",
  model: "anthropic/claude",
  title: `Continue session ${i + 1}`,
  status: "idle",
  exit_code: null,
  archived_at: null,
  created_at: iso((i + 1) * 120),
  updated_at: iso((i + 1) * 60),
  attention: { state: "none", since: null, reason: null },
  familiarId: "nova",
  hasLocalConversation: true,
}));

async function openHome(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "nova");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  );
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.goto("/?mode=home");
  await expect(page.locator(".home-continue")).toBeVisible({ timeout: 45_000 });
}

const cards = (page: Page) => page.locator(".home-continue__card");
const deck = (page: Page) => page.locator(".home-continue__cards");
const next = (page: Page) => page.getByRole("button", { name: "More sessions" });
const previous = (page: Page) => page.getByRole("button", { name: "Previous sessions" });

/** The visible headline on each rendered card. */
const titles = (page: Page) => page.locator(".home-continue__title").allTextContents();

/** The accessible name of whatever the browser considers focused. */
function focusedLabel(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const title = el.querySelector(".home-continue__title")?.textContent;
    return title ?? el.getAttribute("aria-label");
  });
}

test.describe("Home Continue carousel", () => {
  test("pages past the third session instead of truncating", async ({ page }) => {
    await openHome(page);
    await expect(cards(page)).toHaveCount(3);
    expect(await titles(page)).toEqual([
      "Continue session 1",
      "Continue session 2",
      "Continue session 3",
    ]);

    await next(page).click();
    expect(await titles(page)).toEqual([
      "Continue session 4",
      "Continue session 5",
      "Continue session 6",
    ]);
    await expect(deck(page)).toHaveAttribute("aria-label", "Sessions 4 to 6 of 9");

    await next(page).click();
    expect(await titles(page)).toEqual([
      "Continue session 7",
      "Continue session 8",
      "Continue session 9",
    ]);
    await expect(next(page)).toBeDisabled();
  });

  test("an arrow key at the page edge carries focus onto the card that arrives", async ({ page }) => {
    await openHome(page);
    await cards(page).nth(0).focus();
    await page.keyboard.press("ArrowRight");
    expect(await focusedLabel(page)).toBe("Continue session 2");

    await page.keyboard.press("ArrowRight");
    expect(await focusedLabel(page)).toBe("Continue session 3");

    // The three cards it was walking unmount here. Focus must not fall to the
    // document — it belongs on the first card of the page that replaced them.
    await page.keyboard.press("ArrowRight");
    expect(await titles(page)).toEqual([
      "Continue session 4",
      "Continue session 5",
      "Continue session 6",
    ]);
    expect(await focusedLabel(page)).toBe("Continue session 4");

    // And back the other way, onto the LAST card of the previous page.
    await page.keyboard.press("ArrowLeft");
    expect(await focusedLabel(page)).toBe("Continue session 3");
  });

  test("End and Home reach the ends of the list from the keyboard", async ({ page }) => {
    await openHome(page);
    await cards(page).nth(0).focus();
    await page.keyboard.press("End");
    expect(await focusedLabel(page)).toBe("Continue session 9");

    await page.keyboard.press("Home");
    expect(await focusedLabel(page)).toBe("Continue session 1");
  });

  test("a pager button its own click disables hands focus to its sibling", async ({ page }) => {
    await openHome(page);
    await next(page).focus();
    await page.keyboard.press("Enter");
    expect(await focusedLabel(page)).toBe("More sessions");

    // This press lands on the last page, so "More sessions" disables. A
    // disabled button cannot hold focus, and losing it would strand the reader
    // at the top of the document.
    await page.keyboard.press("Enter");
    await expect(next(page)).toBeDisabled();
    expect(await focusedLabel(page)).toBe("Previous sessions");
  });

  test("the pager takes keyboard focus and paints a visible focus ring", async ({ page }) => {
    await openHome(page);
    // Tab there for real rather than calling focus(): `.focus-ring` paints on
    // `:focus-visible`, which is a keyboard-modality question. "Previous
    // sessions" is disabled on page 1, so Tab out of the last card reaches
    // "More sessions".
    await cards(page).nth(2).focus();
    await page.keyboard.press("Tab");
    await expect(next(page)).toBeFocused();

    // Not merely "some ring": the DESIGN SYSTEM's ring. Chromium paints its
    // own `outline-style: auto` at offset 0 on any focused button, so an
    // element that had lost `.focus-ring` would still look ringed here while
    // no longer following --ring-* through a theme change. The expected
    // geometry is read off the token layer, so a token retune moves both
    // sides together instead of failing.
    const ring = await next(page).evaluate((el) => {
      const root = getComputedStyle(document.documentElement);
      const style = getComputedStyle(el);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        offset: style.outlineOffset,
        expectedWidth: root.getPropertyValue("--ring-width").trim(),
        expectedOffset: root.getPropertyValue("--ring-offset").trim(),
      };
    });
    expect(ring.style).toBe("solid");
    expect(Number.parseFloat(ring.width)).toBeGreaterThan(0);
    expect(ring.width).toBe(ring.expectedWidth);
    expect(ring.offset).toBe(ring.expectedOffset);
  });

  test("a screen reader is told which sessions the new page holds", async ({ page }) => {
    await openHome(page);
    const live = page.locator(".home-continue__live");
    // Silent on arrival: nothing has changed yet.
    await expect(live).toHaveText("");
    await next(page).click();
    await expect(live).toHaveText("Sessions 4 to 6 of 9");
  });

  test("the page-turn animation runs normally, and not at all under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openHome(page);
    await expect(deck(page)).toHaveCSS("animation-name", "home-continue-page-in");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(deck(page)).toHaveCSS("animation-name", "none");
    // Paging still works with the motion removed.
    await next(page).click();
    expect(await titles(page)).toEqual([
      "Continue session 4",
      "Continue session 5",
      "Continue session 6",
    ]);
    await expect(deck(page)).toHaveCSS("animation-name", "none");
  });

  test("no pager when every resumable session already fits on one page", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
      window.localStorage.setItem("cave:active-familiar", "nova");
    });
    await page.route("**/api/familiars**", (route) =>
      route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } }),
    );
    await page.route("**/api/sessions/list**", (route) =>
      route.fulfill({ json: { ok: true, sessions: SESSIONS.slice(0, 2) } }),
    );
    await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
    await page.goto("/?mode=home");
    await expect(cards(page)).toHaveCount(2, { timeout: 45_000 });
    await expect(next(page)).toHaveCount(0);
    await expect(previous(page)).toHaveCount(0);
  });
});
