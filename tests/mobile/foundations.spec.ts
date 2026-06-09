import { expect, test } from "@playwright/test";

// Starter mobile spec. Loads the home route on the pixel-5 and
// iphone-13 viewport projects and asserts the phase 1 foundations:
//
//   - viewport meta is set to viewport-fit=cover so env() returns
//     non-zero on iOS
//   - the layout doesn't trigger horizontal scrolling at 360px
//   - the top-bar mobile-toggle is visible (since these viewports
//     are below the 768px breakpoint, the toggles must render)
//
// Surface-specific specs (chat composer, board card-stack, calendar
// agenda, hover-tap) belong in their own files; this one is the
// "did the foundation land at all" canary.

test.describe("mobile foundations", () => {
  test("viewport meta sets viewport-fit=cover", async ({ page }) => {
    await page.goto("/");
    const viewport = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(viewport, "viewport meta must include viewport-fit=cover").toMatch(
      /viewport-fit=cover/,
    );
  });

  test("home route fits 360px without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto("/");
    const overflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow, "no horizontal overflow at 360px viewport").toBeLessThanOrEqual(0);
  });

  test("mobile drawer toggles render on phone viewport", async ({ page }) => {
    await page.goto("/");
    // The .top-bar__mobile-toggle class is `display: none` on desktop
    // and `display: inline-flex` under @media (max-width: 767px). At
    // least one (the nav hamburger) is always wired by workspace.tsx.
    const toggles = page.locator(".top-bar__mobile-toggle");
    await expect(toggles.first()).toBeVisible();
  });
});
