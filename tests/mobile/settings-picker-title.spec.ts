import { expect, test } from "@playwright/test";

// #6243: the top bar already titles the mobile Settings picker, so the rail's
// "Settings" eyebrow must not repeat it above the search field.
test("the mobile Settings picker is not titled again above its search", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.goto("/settings");

  const picker = page.locator("nav.settings-shell__sidebar");
  await expect(picker.getByRole("searchbox", { name: "Search settings" })).toBeVisible({ timeout: 30_000 });
  await expect(picker.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
  await expect(picker.getByText("Settings", { exact: true })).toHaveCount(0);
});
