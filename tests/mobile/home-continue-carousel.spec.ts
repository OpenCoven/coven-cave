import { expect, test, type Page } from "@playwright/test";

/**
 * Home's Continue carousel on phone widths (cave-9oi1s).
 *
 * Runs on the pixel-5 and iphone-13 projects. A carousel is easy to build so
 * that it fits the designer's viewport and pushes the document sideways on a
 * real phone — cave-lcxc6 is the local precedent, where a 320px panel pinned
 * over the chrome of a 390px viewport made a control untappable. So the sweep
 * below drives the real widths and measures the document itself.
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

/** Nine resumable sessions, with a long title so a card cannot quietly widen
 *  the strip past the viewport. */
const SESSIONS = Array.from({ length: 9 }, (_, i) => ({
  id: `s-${i + 1}`,
  project_root: process.cwd(),
  harness: "claude",
  model: "anthropic/claude",
  title: `Continue session ${i + 1} with a deliberately long thread title that must not widen the strip`,
  status: "idle",
  exit_code: null,
  archived_at: null,
  created_at: iso((i + 1) * 120),
  updated_at: iso((i + 1) * 60),
  attention: { state: "none", since: null, reason: null },
  familiarId: "nova",
  hasLocalConversation: true,
}));

/** iPhone SE, iPhone SE 2/3, iPhone 13, Pixel 5. */
const PHONE_WIDTHS = [320, 375, 390, 393];

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
const next = (page: Page) => page.getByRole("button", { name: "More sessions" });

/** Playwright rounds fractional layout to whole CSS pixels, so one pixel of
 *  slack is measurement noise rather than overflow. */
function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("Home Continue carousel on phone widths", () => {
  for (const width of PHONE_WIDTHS) {
    test(`the carousel fits a ${width}px viewport without horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openHome(page);

      expect(await horizontalOverflow(page), `page 1 overflows at ${width}px`).toBeLessThanOrEqual(1);

      // The deck and the pager are the two new boxes; neither may reach past
      // the viewport even though the strip is centered inside the hearth card.
      for (const selector of [".home-continue__cards", ".home-continue__pager"]) {
        const box = await page.locator(selector).boundingBox();
        expect(box, `${selector} must be laid out at ${width}px`).not.toBeNull();
        expect(box!.x, `${selector} starts left of the viewport at ${width}px`).toBeGreaterThanOrEqual(-1);
        expect(
          box!.x + box!.width,
          `${selector} runs past the viewport at ${width}px`,
        ).toBeLessThanOrEqual(width + 1);
      }

      // Turning the page must not introduce overflow either — the last page is
      // short, and a stale three-column track would leave the row wider.
      await next(page).click();
      await expect(cards(page).first()).toBeVisible();
      expect(await horizontalOverflow(page), `page 2 overflows at ${width}px`).toBeLessThanOrEqual(1);

      await next(page).click();
      await expect(cards(page).first()).toBeVisible();
      expect(await horizontalOverflow(page), `page 3 overflows at ${width}px`).toBeLessThanOrEqual(1);
    });
  }

  test("the cards stack to one column and the pager stays a thumb-sized target", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openHome(page);

    const boxes = await cards(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().x),
    );
    expect(boxes.length).toBe(3);
    expect(new Set(boxes).size, "stacked cards share one column").toBe(1);

    const button = await next(page).boundingBox();
    expect(button).not.toBeNull();
    expect(button!.width, "the pager button is a full touch target").toBeGreaterThanOrEqual(44);
    expect(button!.height, "the pager button is a full touch target").toBeGreaterThanOrEqual(44);
  });

  test("tapping through the pages works at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 780 });
    await openHome(page);
    await expect(cards(page)).toHaveCount(3);

    await next(page).tap();
    await expect(page.locator(".home-continue__cards")).toHaveAttribute(
      "aria-label",
      "Sessions 4 to 6 of 9",
    );
    await expect(cards(page)).toHaveCount(3);
  });
});
