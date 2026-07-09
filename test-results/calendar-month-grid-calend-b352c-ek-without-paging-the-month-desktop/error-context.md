# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar-month-grid.spec.ts >> calendar month grid keyboard model >> arrows rove the cells (→ +1 day, ↓ +1 week) without paging the month
- Location: tests/calendar-month-grid.spec.ts:59:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.goto: Test timeout of 60000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:3100/", waiting until "load"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - navigation "Chat with familiars and view tasks" [ref=e5]:
    - search [ref=e6]:
      - searchbox "Search anything or ask Salem, the docs familiar" [ref=e7]
      - generic [ref=e8]: ⌘K
    - generic [ref=e9]:
      - button "Quick chat" [ref=e10] [cursor=pointer]
      - button "Select a familiar to enhance tasks" [disabled] [ref=e11] [cursor=pointer]
      - button "View tasks" [ref=e12] [cursor=pointer]
      - button "View schedules" [ref=e13] [cursor=pointer]
  - status [ref=e16]
  - alert [ref=e17]
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | // Behavioral coverage for the month grid's keyboard model (cave-zqsj #2670 +
  4   | // cave-sth7 #2710, filed as cave-j5q0). The model is otherwise pinned only by
  5   | // source scans, which verify code shape but not real DOM behavior — exactly
  6   | // the weak spot for roving-focus work. Daemon-less (COVEN_CAVE_E2E=1): the
  7   | // grid's semantics don't need data, so the API stubs return empty sets.
  8   | 
  9   | async function gotoMonthGrid(page: Page) {
  10  |   await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [] } }));
  11  |   await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  12  |   await page.addInitScript(() => {
  13  |     window.localStorage.setItem("cave:onboarding:dismissed", "1");
  14  |   });
> 15  |   await page.goto("/");
      |              ^ Error: page.goto: Test timeout of 60000ms exceeded.
  16  |   // The shell must be mounted before the mode-switch listener exists. Wait for
  17  |   // real hydration (the top-bar searchbox is interactive on every boot
  18  |   // surface), then re-fire the mode switch until the surface appears — the
  19  |   // calendar chunk compiles on demand under `next dev`, and the first open
  20  |   // per worker pays that cost.
  21  |   await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
  22  |   await expect(async () => {
  23  |     await page.evaluate(() =>
  24  |       window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "calendar" } })),
  25  |     );
  26  |     await expect(page.getByRole("group", { name: "Calendar view" })).toBeVisible({ timeout: 3_000 });
  27  |   }).toPass({ timeout: 60_000 });
  28  |   await page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Month" }).click();
  29  |   await page.getByRole("grid").waitFor({ timeout: 10_000 });
  30  | }
  31  | 
  32  | const cells = (page: Page) => page.locator('[data-month-cell="true"]');
  33  | 
  34  | /** Index of the focused element within the month cells, or -1. */
  35  | const focusedCellIndex = (page: Page) =>
  36  |   page.evaluate(() => {
  37  |     const all = Array.from(document.querySelectorAll('[data-month-cell="true"]'));
  38  |     return all.indexOf(document.activeElement as Element);
  39  |   });
  40  | 
  41  | test.describe("calendar month grid keyboard model", () => {
  42  |   test("is a real grid with exactly one roving tab stop and no nested tab stops", async ({ page }) => {
  43  |     await gotoMonthGrid(page);
  44  | 
  45  |     await expect(cells(page)).toHaveCount(42);
  46  |     // WAI-ARIA grid: one tab stop, everything else tabIndex=-1.
  47  |     const stops = await cells(page).evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).length);
  48  |     expect(stops).toBe(1);
  49  |     // The nested date-number buttons must not add 42 extra Tab stops
  50  |     // (cave-sth7): every one is tab-skipped but still present for the mouse.
  51  |     const dateButtons = page.locator('[data-month-cell="true"] button[aria-label^="Open "]');
  52  |     await expect(dateButtons).toHaveCount(42);
  53  |     const tabbableDates = await dateButtons.evaluateAll(
  54  |       (els) => els.filter((el) => (el as HTMLElement).tabIndex !== -1).length,
  55  |     );
  56  |     expect(tabbableDates).toBe(0);
  57  |   });
  58  | 
  59  |   test("arrows rove the cells (→ +1 day, ↓ +1 week) without paging the month", async ({ page }) => {
  60  |     await gotoMonthGrid(page);
  61  |     const monthLabel = await page.getByRole("grid").getAttribute("aria-label");
  62  | 
  63  |     // Focus the grid's tab stop, then rove.
  64  |     await page.evaluate(() => {
  65  |       const stop = Array.from(document.querySelectorAll<HTMLElement>('[data-month-cell="true"]')).find(
  66  |         (el) => el.tabIndex === 0,
  67  |       );
  68  |       stop?.focus();
  69  |     });
  70  |     const start = await focusedCellIndex(page);
  71  |     expect(start).toBeGreaterThanOrEqual(0);
  72  | 
  73  |     await page.keyboard.press("ArrowRight");
  74  |     expect(await focusedCellIndex(page)).toBe(start + 1);
  75  | 
  76  |     await page.keyboard.press("ArrowDown");
  77  |     expect(await focusedCellIndex(page)).toBe(start + 8);
  78  | 
  79  |     // The grid owns its arrows: the month must NOT have paged underneath.
  80  |     await expect(page.getByRole("grid")).toHaveAttribute("aria-label", monthLabel!);
  81  |   });
  82  | 
  83  |   test("Shift+Enter on a cell opens the Day view", async ({ page }) => {
  84  |     await gotoMonthGrid(page);
  85  |     await page.evaluate(() => {
  86  |       const stop = Array.from(document.querySelectorAll<HTMLElement>('[data-month-cell="true"]')).find(
  87  |         (el) => el.tabIndex === 0,
  88  |       );
  89  |       stop?.focus();
  90  |     });
  91  |     await page.keyboard.press("Shift+Enter");
  92  |     await expect(
  93  |       page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Day" }),
  94  |     ).toHaveAttribute("aria-pressed", "true");
  95  |   });
  96  | 
  97  |   test("arrows outside the grid still page the month", async ({ page }) => {
  98  |     await gotoMonthGrid(page);
  99  |     const monthLabel = await page.getByRole("grid").getAttribute("aria-label");
  100 | 
  101 |     // Focus page chrome (not a field, not the grid) — the global handler pages.
  102 |     await page.mouse.click(5, 5);
  103 |     await page.keyboard.press("ArrowRight");
  104 |     await expect(page.getByRole("grid")).not.toHaveAttribute("aria-label", monthLabel!);
  105 |   });
  106 | });
  107 | 
```