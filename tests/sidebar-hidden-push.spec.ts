import { expect, test, type Locator, type Page } from "@playwright/test";

async function seedClosedSidebar(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "0");
    window.localStorage.setItem("cave:shell:nav-open:source", "user");
  });
}

// Await the SETTLED panel state rather than the toggle transition:
// aria-expanded is derived from the panel's measured width via the nav
// Panel's onResize callback, so it converges a frame after the width does.
// Polling the PAIR (aria state AND width) passes only once the panel has
// stopped moving and the toggle agrees with it, which is the state a real
// user perceives.
async function expectNavSettled(
  toggle: Locator,
  navPanel: Locator,
  expected: "open" | "closed",
) {
  await expect
    .poll(async () => {
      const expanded = await toggle.getAttribute("aria-expanded");
      const width =
        (await navPanel.boundingBox())?.width ?? (expected === "open" ? 0 : 1);
      return expected === "open"
        ? expanded === "true" && width >= 220
        : expanded === "false" && width <= 1;
    })
    .toBe(true);
}

async function dispatchTouchSwipe(
  page: Page,
  selector: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.evaluate(
    ({ selector, from, to }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`Missing swipe target: ${selector}`);
      const init = {
        pointerType: "touch",
        pointerId: 41,
        isPrimary: true,
        bubbles: true,
        cancelable: true,
      };
      target.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: from.x, clientY: from.y }));
      target.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: to.x, clientY: to.y }));
      target.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: to.x, clientY: to.y }));
    },
    { selector, from, to },
  );
}

test("closing navigation removes the rail and opening pushes the main panel", async ({ page }) => {
  await seedClosedSidebar(page);
  await page.goto("/?demo=1");

  const navPanel = page.locator(".shell-nav-panel");
  const detail = page.locator(".shell-detail");
  const toggle = page.locator(".shell-top-toggle--nav");

  await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".shell-nav--rail, .shell-nav--peek")).toHaveCount(0);
  await expect(page.locator(".shell-nav")).toHaveAttribute("aria-hidden", "true");

  const closedNav = await navPanel.boundingBox();
  const closedDetail = await detail.boundingBox();
  expect(closedNav?.width ?? 1).toBeLessThanOrEqual(1);

  await toggle.click();
  await expectNavSettled(toggle, navPanel, "open");
  await expect(page.locator(".shell-nav")).toHaveAttribute("aria-hidden", "false");

  const openNav = await navPanel.boundingBox();
  const openDetail = await detail.boundingBox();
  expect(openNav?.width ?? 0).toBeGreaterThanOrEqual(220);
  expect((openDetail?.x ?? 0) - (closedDetail?.x ?? 0)).toBeGreaterThanOrEqual(200);

  await toggle.click();
  await expectNavSettled(toggle, navPanel, "closed");
});

test("the fully closed sidebar remains closed after reload", async ({ page }) => {
  await seedClosedSidebar(page);
  await page.goto("/?demo=1");
  await expect(page.locator(".shell-top-toggle--nav")).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.locator(".shell-top-toggle--nav")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await page.locator(".shell-nav-panel").boundingBox())?.width ?? 1).toBeLessThanOrEqual(1);
});

test("touch edge swipe opens and sidebar swipe closes without taking content swipes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await seedClosedSidebar(page);
  await page.goto("/?demo=1");
  await expect(page.locator(".shell-frame")).toBeVisible();

  await dispatchTouchSwipe(page, ".shell-frame", { x: 96, y: 320 }, { x: 180, y: 324 });
  await expect(page.locator(".shell-root")).not.toHaveAttribute("data-mobile-drawer", "nav");

  await dispatchTouchSwipe(page, ".shell-frame", { x: 4, y: 320 }, { x: 92, y: 324 });
  await expect(page.locator(".shell-root")).toHaveAttribute("data-mobile-drawer", "nav");
  await expect(page.locator(".shell-nav-panel")).toBeVisible();

  await dispatchTouchSwipe(page, ".shell-nav-panel", { x: 250, y: 320 }, { x: 150, y: 324 });
  await expect(page.locator(".shell-root")).not.toHaveAttribute("data-mobile-drawer", "nav");
});
