import { expect, test } from "@playwright/test";

// #6243: the top bar already titles the mobile Settings picker, so neither the
// rail's "Settings" eyebrow nor the header band's title may repeat it. The
// band keeps its Back button.
test("the mobile Settings picker is titled once, by the top bar", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.goto("/settings");

  const picker = page.locator("nav.settings-shell__sidebar");
  const band = page.locator("header.settings-shell__header");
  await expect(picker.getByRole("searchbox", { name: "Search settings" })).toBeVisible({ timeout: 30_000 });
  await expect(picker.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
  await expect(picker.getByText("Settings", { exact: true })).toHaveCount(0);
  await expect(band.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(band.getByText("CovenCave control room")).toHaveCount(0);

  // Opening a section titles the band with that section, as before.
  await picker.getByRole("button", { name: "General", exact: true }).click();
  await expect(band.locator(".surface-compact-title")).toHaveText("General");
});
