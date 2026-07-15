import { expect, test, type Page } from "@playwright/test";

// Behavioral coverage for the keyboard-shortcuts sheet (⌘/ or ?) — a core
// discoverability surface that had no e2e/behavioral test. The catalog is
// static, so this only needs the surfaces' /api fetches stubbed empty +
// dismissed onboarding. Also guards the catalog groups (incl. the
// Terminal/Browser groups added in #1605) and the "don't fire while typing" rule.

async function gotoApp(page: Page) {
  await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.goto("/");
  // Wait until the workspace has hydrated — the global keydown handler is
  // attached in a useEffect, so a key pressed before hydration is lost. The app
  // boots into Chat (cave-hsa6); the always-present top-bar search input (role
  // searchbox) is the reliable "interactive now" signal on every boot surface.
  await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(500);
}

// The sheet is a Modal labelled via its breadcrumb header (aria-labelledby),
// so match the dialog by its accessible name rather than an aria-label attr.
const sheet = (page: Page) => page.getByRole("dialog", { name: /Keyboard shortcuts/ });

// "Terminal & panes" was removed from the catalog — its bindings lived only in
// the unmounted ComuxView, and the sheet stays truthful (cave-7c9i).
const GROUPS = ["Panels & navigation", "Browser", "Composer", "Slash menu", "Other"];

test.describe("keyboard shortcuts sheet", () => {
  test("opens with ?, lists every catalog group, closes with Escape", async ({ page }) => {
    await gotoApp(page);
    // Focus the page chrome (not a text field) so the `?` guard lets it through.
    await page.mouse.click(5, 5);
    await page.keyboard.press("?");

    await expect(sheet(page)).toBeVisible();
    for (const group of GROUPS) {
      await expect(sheet(page).locator(`section[aria-label="${group}"]`)).toBeVisible();
    }
    // Representative rows, including one from the #1605 additions.
    await expect(sheet(page).getByText("Open the command palette")).toBeVisible();
    await expect(sheet(page).getByText("Recall prompt history (home composer, empty input)")).toBeVisible();
    // Removed-with-the-group row must NOT resurface (cave-7c9i).
    await expect(sheet(page).getByText("Broadcast input to every visible pane")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });

  test("⌘/ also opens the sheet", async ({ page }) => {
    await gotoApp(page);
    await page.mouse.click(5, 5);
    await page.keyboard.press("Meta+/");
    await expect(sheet(page)).toBeVisible();
  });

  test("? does nothing while typing in a text field", async ({ page }) => {
    await gotoApp(page);
    // Any editable target exercises the guard; the top-bar search input is the
    // one always present on the chat boot surface (cave-hsa6).
    const editable = page.getByRole("searchbox").first();
    await editable.click();
    await editable.pressSequentially("?");
    // The guard (isEditableTarget) must suppress the sheet so "?" types normally.
    await expect(sheet(page)).toBeHidden();
  });
});
