import { expect, test } from "@playwright/test";

// Reproduce the native inspection's traffic-light collision using the production
// marker and titlebar tokens. This checks CSS geometry, not native window behavior.
for (const viewport of [{ width: 1320, height: 820 }, { width: 960, height: 600 }]) {
  test.describe(`${viewport.width}px native titlebar clearance`, () => {
    test.use({ viewport, serviceWorkers: "block" });
    test("edge presentations clear visible traffic lights and release the reserve when hidden", async ({ page }, testInfo) => {
      await page.goto("/aesthetic");
      for (const label of ["Fullscreen", "Left sheet", "Right sheet", "Standard dialog"]) {
        const opener = page.getByRole("button", { name: label, exact: true });
        await opener.click();
        const dialog = page.getByRole("dialog", { name: label, exact: true });
        await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
        await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
        const baselinePadding = await dialog.locator(".ui-modal-header").evaluate(element => getComputedStyle(element).paddingBlockStart);
        await page.locator("html").evaluate(element => { element.setAttribute("data-tauri-titlebar", ""); });
        const reserve = await page.locator("html").evaluate(element => {
          const style = getComputedStyle(element);
          return { width: parseFloat(style.getPropertyValue("--titlebar-lights-inset")), height: parseFloat(style.getPropertyValue("--shell-native-titlebar-height")) };
        });
        expect(reserve.width).toBeGreaterThan(0);
        expect(reserve.height).toBeGreaterThan(0);
        await page.screenshot({ path: testInfo.outputPath(`${label.toLowerCase().replaceAll(" ", "-")}-native-reserve.png`), animations: "disabled" });
        for (const control of [dialog.getByRole("heading", { name: label, exact: true }), dialog.getByRole("button", { name: "Close", exact: true })]) {
          const bounds = (await control.boundingBox())!;
          expect(bounds.x >= reserve.width || bounds.y >= reserve.height, `${label}: ${JSON.stringify(bounds)} overlaps the native ${JSON.stringify(reserve)} reserve`).toBe(true);
          await expect(control).toBeInViewport({ ratio: 1 });
        }
        if (label === "Standard dialog") {
          await expect(dialog.locator(".ui-modal-header")).toHaveCSS("padding-block-start", baselinePadding);
        }
        for (const [attribute, value] of [["data-window-fullscreen", ""], ["data-traffic-lights", "hidden"]]) {
          await page.locator("html").evaluate((element, [name, content]) => element.setAttribute(name, content), [attribute, value]);
          await expect(dialog.locator(".ui-modal-header")).toHaveCSS("padding-block-start", baselinePadding);
          await page.locator("html").evaluate((element, name) => element.removeAttribute(name), attribute);
        }
        await page.locator("html").evaluate(element => element.removeAttribute("data-tauri-titlebar"));
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
      }
    });
  });
}
