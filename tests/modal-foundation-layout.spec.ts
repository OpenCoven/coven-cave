import { expect, test } from "@playwright/test";
import { createDefaultPreferences } from "../src/lib/preferences-schema";

test.use({ serviceWorkers: "block" });

const variants = ["Compact confirmation", "Standard dialog", "Wide dialog", "Reader dialog", "Workspace dialog", "Left sheet", "Right sheet", "Fullscreen"];
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;

// Render the production reference route, not a reimplementation of its shell.
// Canonical preference responses vary the specimen without saving user preferences.
for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px modal layouts`, () => {
    test.use({ viewport, hasTouch: viewport.width === 390 });
    for (const theme of themes) {
      test(`${theme.theme}/${theme.mode}: every presentation contains long content and reachable actions`, async ({ page }, testInfo) => {
        const preferences = createDefaultPreferences(true);
        preferences.appearance.theme = { ...preferences.appearance.theme, id: theme.theme, modePreference: theme.mode, resolvedMode: theme.mode };
        await page.route("**/api/preferences", route => route.fulfill({ json: { ok: true, preferences } }));
        await page.route("**/api/theme", route => route.fulfill({ json: { ok: true, theme: { themeId: theme.theme, mode: theme.mode, modePreference: theme.mode, revision: preferences.revision, selectionRevision: preferences.appearance.theme.selectionRevision } } }));
        await page.goto("/aesthetic");
        await page.getByRole("checkbox", { name: "Long content" }).check();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme.theme);
        await expect(page.locator("html")).toHaveAttribute("data-mode", theme.mode);
        for (const label of variants) {
          await page.getByRole("button", { name: label, exact: true }).click();
          const modal = page.getByRole("dialog", { name: label, exact: true });
          await expect(modal).toBeVisible();
          await expect(modal.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
          // Measure final touch targets, after the finite entrance transform.
          await modal.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
          const geometry = await modal.evaluate(element => {
            const box = (selector: string) => {
              const { left, right, top, bottom } = element.querySelector(selector)!.getBoundingClientRect();
              return { left, right, top, bottom };
            };
            const { left, right, top, bottom } = element.getBoundingClientRect();
            const body = element.querySelector(".ui-modal-body")!;
            return { left, right, top, bottom, header: box(".ui-modal-header"), body: box(".ui-modal-body"), footer: box(".ui-modal-footer"), overflow: body.scrollHeight - body.clientHeight };
          });
          expect(geometry.left, label).toBeGreaterThanOrEqual(-1);
          expect(geometry.right, label).toBeLessThanOrEqual(viewport.width + 1);
          expect(geometry.top, label).toBeGreaterThanOrEqual(-1);
          expect(geometry.bottom, label).toBeLessThanOrEqual(viewport.height + 1);
          expect(geometry.header.bottom, label).toBeLessThanOrEqual(geometry.body.top + 1);
          expect(geometry.body.bottom, label).toBeLessThanOrEqual(geometry.footer.top + 1);
          expect(geometry.overflow, label).toBeGreaterThan(0);
          await modal.locator(".ui-modal-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
          await expect(modal.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
          await expect(modal.getByRole("button", { name: "Preview pending action", exact: true })).toBeInViewport();
          if (viewport.width === 390) {
            for (const name of ["Close", "Cancel", "Preview pending action"]) {
              const bounds = await modal.getByRole("button", { name, exact: true }).boundingBox();
              expect(bounds!.width, `${label}: ${name}`).toBeGreaterThanOrEqual(44);
              expect(bounds!.height, `${label}: ${name}`).toBeGreaterThanOrEqual(44);
            }
          }
          await page.screenshot({ path: testInfo.outputPath(`${label.toLowerCase().replaceAll(" ", "-")}.png`) });
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme.theme);
          await expect(page.locator("html")).toHaveAttribute("data-mode", theme.mode);
          await page.keyboard.press("Escape");
          await expect(modal).toHaveCount(0);
          await expect(page.getByRole("button", { name: label, exact: true })).toBeFocused();
        }
      });
    }
  });
}

test("busy dismissal, nested Escape, focus return and reduced motion share the same owner", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/aesthetic");
  const opener = page.getByRole("button", { name: "Standard dialog", exact: true });
  await opener.click();
  const parent = page.getByRole("dialog", { name: "Standard dialog", exact: true });
  expect(await parent.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await parent.getByRole("button", { name: "Preview pending action", exact: true }).click();
  await expect(parent.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
  await expect(parent.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(parent).toBeVisible();
  await page.locator(".ui-modal-backdrop").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Tab");
  expect(await parent.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await parent.getByRole("button", { name: "Finish pending action", exact: true }).click();
  await parent.getByRole("button", { name: "Open nested dialog", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Nested dialog", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Nested dialog", exact: true })).toHaveCount(0);
  await expect(parent.getByRole("button", { name: "Open nested dialog", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(parent).toHaveCount(0);
  await expect(opener).toBeFocused();
});
