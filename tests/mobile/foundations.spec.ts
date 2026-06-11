import { expect, test } from "@playwright/test";

// Starter mobile spec. Loads the home route on the pixel-5 and
// iphone-13 viewport projects and asserts the phase 1 foundations:
//
//   - viewport meta is set to viewport-fit=cover so env() returns
//     non-zero on iOS
//   - the layout doesn't trigger horizontal scrolling at 360px
//   - the desktop shell does not render the global top header
//   - the top-bar mobile-toggle is visible (since mobile viewports
//     still need drawer controls)
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

  test("home route does not create window-level vertical scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.waitForSelector(".shell-frame");

    const metrics = await page.evaluate(() => {
      const frame = document.querySelector(".shell-frame");
      const frameRect = frame?.getBoundingClientRect();
      return {
        documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
        frameBottom: frameRect?.bottom ?? 0,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics.documentOverflow, "document should not be vertically scrollable").toBeLessThanOrEqual(1);
    expect(metrics.bodyOverflow, "body should not be vertically scrollable").toBeLessThanOrEqual(1);
    expect(metrics.frameBottom, "app frame should fit the viewport").toBeLessThanOrEqual(metrics.viewportHeight + 1);
  });

  test("desktop home route hides the global top header without window scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.waitForSelector(".shell-frame");

    const topBar = page.locator(".top-bar");
    await expect(topBar).toHaveCount(1);
    await expect(topBar).toBeHidden();

    const metrics = await page.evaluate(() => {
      return {
        documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
      };
    });
    expect(metrics.documentOverflow, "document should not be vertically scrollable").toBeLessThanOrEqual(1);
    expect(metrics.bodyOverflow, "body should not be vertically scrollable").toBeLessThanOrEqual(1);
  });

  test("mobile drawer toggles render on phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto("/");
    // The .top-bar__mobile-toggle class is hidden by default and revealed
    // under the mobile/tablet breakpoint. At least one (the nav hamburger)
    // is always wired by workspace.tsx.
    const toggles = page.locator(".top-bar__mobile-toggle");
    await expect(toggles.first()).toBeVisible();
  });
});
