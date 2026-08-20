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
  // A visible searchbox can precede the Workspace effect that owns the global
  // shortcuts. Prove that exact handler is attached through its idempotent ⌘K
  // path before exercising either shortcut-sheet binding.
  await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.mouse.click(640, 5);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect
    .poll(
      async () => {
        await page.keyboard.press("Meta+k");
        return palette.isVisible();
      },
      { timeout: 30_000, message: "Workspace global shortcuts should be interactive" },
    )
    .toBe(true);
  // Getting the palette shut again is setup, not the assertion under test —
  // every test below is about the shortcuts sheet, and nothing here covers the
  // palette's own Escape behavior. A one-shot press therefore made an
  // incidental step a failure mode for all three.
  //
  // It is a swallowed key rather than a slow one, which is why retrying the
  // assertion could not recover it: `useFocusTrap` attaches its Escape listener
  // and moves focus in the SAME post-paint effect, and the handler no-ops
  // unless its trap is topmost — so a press that lands a beat early is dropped,
  // not queued, and `toBeHidden` then polls a palette that will never close.
  // That is how main run 32303914004 held it visible through the whole 5s
  // window and failed outright rather than flaking to a pass (cave-i1c).
  //
  // So wait for the trap's observable half — focus inside the dialog, the guard
  // right-chat-panel.spec.ts already uses — and then press until it actually
  // closes, mirroring the open poll above. Both loops stop on the first press
  // that takes effect, so neither sends a stray key.
  await expect(palette.locator(":focus")).toHaveCount(1);
  await expect
    .poll(
      async () => {
        await page.keyboard.press("Escape");
        return palette.isVisible();
      },
      { timeout: 15_000, message: "Command palette should close on Escape" },
    )
    .toBe(false);
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
    await page.mouse.click(640, 5);
    await page.keyboard.press("?");

    await expect(sheet(page)).toBeVisible();
    for (const group of GROUPS) {
      await expect(sheet(page).locator(`section[aria-label="${group}"]`)).toBeVisible();
    }
    // Representative rows, including one from the #1605 additions.
    await expect(sheet(page).getByText("Open the command palette")).toBeVisible();
    await expect(sheet(page).getByText("Toggle the right Chat panel")).toBeVisible();
    await expect(sheet(page).getByText("Recall prompt history (home composer, empty input)")).toBeVisible();
    // Removed-with-the-group row must NOT resurface (cave-7c9i).
    await expect(sheet(page).getByText("Broadcast input to every visible pane")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });

  test("⌘/ also opens the sheet", async ({ page }) => {
    await gotoApp(page);
    await page.mouse.click(640, 5);
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
