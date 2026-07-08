import { expect, test, type Page } from "@playwright/test";

// Behavioral coverage for the month grid's keyboard model (cave-zqsj #2670 +
// cave-sth7 #2710, filed as cave-j5q0). The model is otherwise pinned only by
// source scans, which verify code shape but not real DOM behavior — exactly
// the weak spot for roving-focus work. Daemon-less (COVEN_CAVE_E2E=1): the
// grid's semantics don't need data, so the API stubs return empty sets.

async function gotoMonthGrid(page: Page) {
  await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.goto("/");
  // The shell must be mounted before the mode-switch listener exists. Wait for
  // real hydration (the top-bar searchbox is interactive on every boot
  // surface), then re-fire the mode switch until the surface appears — the
  // calendar chunk compiles on demand under `next dev`, and the first open
  // per worker pays that cost.
  await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "calendar" } })),
    );
    await expect(page.getByRole("group", { name: "Calendar view" })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Month" }).click();
  await page.getByRole("grid").waitFor({ timeout: 10_000 });
}

const cells = (page: Page) => page.locator('[data-month-cell="true"]');

/** Index of the focused element within the month cells, or -1. */
const focusedCellIndex = (page: Page) =>
  page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-month-cell="true"]'));
    return all.indexOf(document.activeElement as Element);
  });

test.describe("calendar month grid keyboard model", () => {
  test("is a real grid with exactly one roving tab stop and no nested tab stops", async ({ page }) => {
    await gotoMonthGrid(page);

    await expect(cells(page)).toHaveCount(42);
    // WAI-ARIA grid: one tab stop, everything else tabIndex=-1.
    const stops = await cells(page).evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).length);
    expect(stops).toBe(1);
    // The nested date-number buttons must not add 42 extra Tab stops
    // (cave-sth7): every one is tab-skipped but still present for the mouse.
    const dateButtons = page.locator('[data-month-cell="true"] button[aria-label^="Open "]');
    await expect(dateButtons).toHaveCount(42);
    const tabbableDates = await dateButtons.evaluateAll(
      (els) => els.filter((el) => (el as HTMLElement).tabIndex !== -1).length,
    );
    expect(tabbableDates).toBe(0);
  });

  test("arrows rove the cells (→ +1 day, ↓ +1 week) without paging the month", async ({ page }) => {
    await gotoMonthGrid(page);
    const monthLabel = await page.getByRole("grid").getAttribute("aria-label");

    // Focus the grid's tab stop, then rove.
    await page.evaluate(() => {
      const stop = Array.from(document.querySelectorAll<HTMLElement>('[data-month-cell="true"]')).find(
        (el) => el.tabIndex === 0,
      );
      stop?.focus();
    });
    const start = await focusedCellIndex(page);
    expect(start).toBeGreaterThanOrEqual(0);

    await page.keyboard.press("ArrowRight");
    expect(await focusedCellIndex(page)).toBe(start + 1);

    await page.keyboard.press("ArrowDown");
    expect(await focusedCellIndex(page)).toBe(start + 8);

    // The grid owns its arrows: the month must NOT have paged underneath.
    await expect(page.getByRole("grid")).toHaveAttribute("aria-label", monthLabel!);
  });

  test("Shift+Enter on a cell opens the Day view", async ({ page }) => {
    await gotoMonthGrid(page);
    await page.evaluate(() => {
      const stop = Array.from(document.querySelectorAll<HTMLElement>('[data-month-cell="true"]')).find(
        (el) => el.tabIndex === 0,
      );
      stop?.focus();
    });
    await page.keyboard.press("Shift+Enter");
    await expect(
      page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Day" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("arrows outside the grid still page the month", async ({ page }) => {
    await gotoMonthGrid(page);
    const monthLabel = await page.getByRole("grid").getAttribute("aria-label");

    // Focus page chrome (not a field, not the grid) — the global handler pages.
    await page.mouse.click(5, 5);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("grid")).not.toHaveAttribute("aria-label", monthLabel!);
  });
});
