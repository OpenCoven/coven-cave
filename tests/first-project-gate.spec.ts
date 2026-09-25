import { expect, test } from "@playwright/test";
import { openFirstProjectGate } from "./fixtures/first-project-gate";

// #5528: the first-project gate is a dialog scoped to the detail pane. Keyboard
// focus stays inside it (it used to Tab out to the top bar and toasts), and
// "Open Tasks" is the keyboard route out that the nav gives mouse users —
// the gate only covers Home and Chat.

test.describe("first-project gate", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Tab stays inside the gate", async ({ page }) => {
    const gate = await openFirstProjectGate(page);
    await expect(gate.getByLabel("Project name")).toBeFocused();

    const insideAfterEachTab: boolean[] = [];
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Tab");
      insideAfterEachTab.push(
        await gate.evaluate((dialog) => dialog.contains(document.activeElement)),
      );
    }
    expect(insideAfterEachTab.every(Boolean), `focus left the gate: ${insideAfterEachTab}`).toBe(true);

    await page.keyboard.press("Shift+Tab");
    expect(await gate.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  });

  test("Open Tasks leaves the gate for Tasks", async ({ page }) => {
    const gate = await openFirstProjectGate(page);
    await gate.getByRole("button", { name: "Open Tasks" }).focus();
    await page.keyboard.press("Enter");
    await expect(gate).toBeHidden();
    await expect(page.getByRole("region", { name: "Tasks" })).toBeVisible({ timeout: 30_000 });
  });
});
