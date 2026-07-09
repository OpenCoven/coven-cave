# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar-month-grid.spec.ts >> calendar month grid keyboard model >> is a real grid with exactly one roving tab stop and no nested tab stops
- Location: tests/calendar-month-grid.spec.ts:42:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('group', { name: 'Calendar view' })
Expected: visible
Timeout: 3000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 3000ms
  - waiting for getByRole('group', { name: 'Calendar view' })


Call Log:
- Test timeout of 60000ms exceeded
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - link "Skip to main content":
      - /url: "#shell-main-content"
    - generic [ref=e3]:
      - button "Expand navigation" [ref=e4] [cursor=pointer]:
        - img [ref=e5]
      - group "History" [ref=e7]:
        - button "Go back" [ref=e8] [cursor=pointer]:
          - img [ref=e9]
        - button "Go forward" [ref=e11] [cursor=pointer]:
          - img [ref=e12]
      - navigation "Chat with familiars and view tasks" [ref=e15]:
        - search [ref=e16]:
          - img [ref=e17]
          - searchbox "Search anything or ask Salem, the docs familiar" [ref=e19]
          - generic [ref=e20]: CtrlK
        - generic [ref=e21]:
          - button "Quick chat" [ref=e22] [cursor=pointer]:
            - img [ref=e23]
          - button "Select a familiar to enhance tasks" [disabled] [ref=e25] [cursor=pointer]:
            - img [ref=e26]
          - button "View tasks — 152 open" [ref=e28] [cursor=pointer]:
            - img [ref=e29]
            - generic [ref=e31]: 99+
          - button "View schedules — 11 need attention" [ref=e32] [cursor=pointer]:
            - img [ref=e33]
            - generic [ref=e35]: "11"
    - generic [ref=e37]:
      - complementary "Sidebar" [ref=e40]:
        - navigation [ref=e41]:
          - 'button "Switch familiar — scope: all familiars" [ref=e44] [cursor=pointer]':
            - img [ref=e45]
          - button "New chat" [ref=e48] [cursor=pointer]:
            - img [ref=e49]
          - generic [ref=e51]:
            - button "Home — Overview and quick actions (⌘1) · drag into the page to split" [ref=e52] [cursor=pointer]:
              - img [ref=e53]
            - button "Chat — Talk with your familiars — 1:1 or a Group tab for a whole coven (⌘2) · drag into the page to split" [ref=e55] [cursor=pointer]:
              - img [ref=e56]
            - button "99+" [ref=e58] [cursor=pointer]:
              - img [ref=e59]
              - generic [ref=e61]: 99+
            - button "11" [ref=e62] [cursor=pointer]:
              - img [ref=e63]
              - generic [ref=e65]: "11"
            - button "Journal — Your familiars' daily reflections — a tab in the Grimoire" [ref=e66] [cursor=pointer]:
              - img [ref=e67]
            - button "Grimoire — Edit memory, knowledge, and journal markdown as living documents · drag into the page to split" [ref=e69] [cursor=pointer]:
              - img [ref=e70]
            - button "Marketplace — Browse the store and manage your familiars' roles, skills, and capabilities · drag into the page to split" [ref=e72] [cursor=pointer]:
              - img [ref=e73]
            - button "GitHub — Issues and PRs assigned to you · drag into the page to split" [ref=e75] [cursor=pointer]:
              - img [ref=e76]
          - generic [ref=e78]:
            - link "Dashboard" [ref=e79] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e81]
            - button "Settings" [ref=e83] [cursor=pointer]:
              - img [ref=e85]
      - separator
      - main [ref=e89]:
        - status [ref=e91]:
          - generic [ref=e92]: Daemon offline — existing sessions visible but new tasks may not start.
          - button "Start daemon" [ref=e93] [cursor=pointer]
          - button "Dismiss" [ref=e94] [cursor=pointer]:
            - img [ref=e95]
        - heading "Schedules" [level=1] [ref=e98]
  - status [ref=e108]
  - alert [ref=e109]
  - alert [ref=e110]
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
  15  |   await page.goto("/");
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
> 27  |   }).toPass({ timeout: 60_000 });
      |      ^ Error: expect(locator).toBeVisible() failed
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