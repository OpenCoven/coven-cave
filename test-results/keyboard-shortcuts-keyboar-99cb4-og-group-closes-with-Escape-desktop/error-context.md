# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: keyboard-shortcuts.spec.ts >> keyboard shortcuts sheet >> opens with ?, lists every catalog group, closes with Escape
- Location: tests/keyboard-shortcuts.spec.ts:31:7

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
  1  | import { expect, test, type Page } from "@playwright/test";
  2  | 
  3  | // Behavioral coverage for the keyboard-shortcuts sheet (⌘/ or ?) — a core
  4  | // discoverability surface that had no e2e/behavioral test. The catalog is
  5  | // static, so this only needs the surfaces' /api fetches stubbed empty +
  6  | // dismissed onboarding. Also guards the catalog groups (incl. the
  7  | // Terminal/Browser groups added in #1605) and the "don't fire while typing" rule.
  8  | 
  9  | async function gotoApp(page: Page) {
  10 |   await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [] } }));
  11 |   await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  12 |   await page.addInitScript(() => {
  13 |     window.localStorage.setItem("cave:onboarding:dismissed", "1");
  14 |   });
> 15 |   await page.goto("/");
     |              ^ Error: page.goto: Test timeout of 60000ms exceeded.
  16 |   // Wait until the workspace has hydrated — the global keydown handler is
  17 |   // attached in a useEffect, so a key pressed before hydration is lost. The app
  18 |   // boots into Chat (cave-hsa6); the always-present top-bar search input (role
  19 |   // searchbox) is the reliable "interactive now" signal on every boot surface.
  20 |   await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
  21 |   await page.waitForTimeout(500);
  22 | }
  23 | 
  24 | // The sheet is a Modal labelled via its breadcrumb header (aria-labelledby),
  25 | // so match the dialog by its accessible name rather than an aria-label attr.
  26 | const sheet = (page: Page) => page.getByRole("dialog", { name: /Keyboard shortcuts/ });
  27 | 
  28 | const GROUPS = ["Panels & navigation", "Terminal & panes", "Browser", "Composer", "Slash menu", "Other"];
  29 | 
  30 | test.describe("keyboard shortcuts sheet", () => {
  31 |   test("opens with ?, lists every catalog group, closes with Escape", async ({ page }) => {
  32 |     await gotoApp(page);
  33 |     // Focus the page chrome (not a text field) so the `?` guard lets it through.
  34 |     await page.mouse.click(5, 5);
  35 |     await page.keyboard.press("?");
  36 | 
  37 |     await expect(sheet(page)).toBeVisible();
  38 |     for (const group of GROUPS) {
  39 |       await expect(sheet(page).locator(`section[aria-label="${group}"]`)).toBeVisible();
  40 |     }
  41 |     // Representative rows, including one from the #1605 additions.
  42 |     await expect(sheet(page).getByText("Open the command palette")).toBeVisible();
  43 |     await expect(sheet(page).getByText("Broadcast input to every visible pane")).toBeVisible();
  44 | 
  45 |     await page.keyboard.press("Escape");
  46 |     await expect(sheet(page)).toBeHidden();
  47 |   });
  48 | 
  49 |   test("⌘/ also opens the sheet", async ({ page }) => {
  50 |     await gotoApp(page);
  51 |     await page.mouse.click(5, 5);
  52 |     await page.keyboard.press("Meta+/");
  53 |     await expect(sheet(page)).toBeVisible();
  54 |   });
  55 | 
  56 |   test("? does nothing while typing in a text field", async ({ page }) => {
  57 |     await gotoApp(page);
  58 |     // Any editable target exercises the guard; the top-bar search input is the
  59 |     // one always present on the chat boot surface (cave-hsa6).
  60 |     const editable = page.getByRole("searchbox").first();
  61 |     await editable.click();
  62 |     await editable.pressSequentially("?");
  63 |     // The guard (isEditableTarget) must suppress the sheet so "?" types normally.
  64 |     await expect(sheet(page)).toBeHidden();
  65 |   });
  66 | });
  67 | 
```