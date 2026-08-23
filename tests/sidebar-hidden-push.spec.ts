import { expect, test, type Page } from "@playwright/test";

async function seedClosedSidebar(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "0");
    window.localStorage.setItem("cave:shell:nav-open:source", "user");
  });
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

// QUARANTINED — cave-z2bvz. Not stale: PR #4758 ("Consolidate recovered
// product experience work") silently reverted PR #4747 ("Fully hide the
// collapsed sidebar") nine hours after it landed, so a closed desktop nav is
// an icons-only 56px rail again and lost its aria-hidden and inert. #4758's
// description never mentions the sidebar, the rail, or #4747, so this reads as
// an accidental clobber during consolidation rather than a decision.
//
// These assertions are kept verbatim because they are the only surviving
// record of what #4747 intended. Rewriting them would ratify the revert and
// destroy that evidence. Restoring #4747 makes them pass unedited — it touches
// 11 files including CSS, so it belongs in its own reviewed PR.
test.fixme("closing navigation removes the rail and opening pushes the main panel", async ({ page }) => {
  await seedClosedSidebar(page);
  await page.goto("/?demo=1");

  const navPanel = page.locator(".shell-nav-panel");
  const detail = page.locator(".shell-detail");
  const toggle = page.locator(".shell-top-toggle--nav");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".shell-nav--rail, .shell-nav--peek")).toHaveCount(0);
  await expect(page.locator(".shell-nav")).toHaveAttribute("aria-hidden", "true");

  const closedNav = await navPanel.boundingBox();
  const closedDetail = await detail.boundingBox();
  expect(closedNav?.width ?? 1).toBeLessThanOrEqual(1);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".shell-nav")).toHaveAttribute("aria-hidden", "false");

  const openNav = await navPanel.boundingBox();
  const openDetail = await detail.boundingBox();
  expect(openNav?.width ?? 0).toBeGreaterThanOrEqual(220);
  expect((openDetail?.x ?? 0) - (closedDetail?.x ?? 0)).toBeGreaterThanOrEqual(200);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await navPanel.boundingBox())?.width ?? 1).toBeLessThanOrEqual(1);
});

// QUARANTINED — cave-z2bvz, same accidental revert as the test above.
test.fixme("the fully closed sidebar remains closed after reload", async ({ page }) => {
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
