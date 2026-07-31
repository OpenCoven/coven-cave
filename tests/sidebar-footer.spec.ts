import { expect, test } from "@playwright/test";

test("collapsed rail places Dashboard directly above Settings", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "0");
  });

  await page.goto("/?demo=1");

  const footer = page.locator(".shell-nav--rail .sidebar-foot");
  const dashboard = footer.getByRole("link", { name: "Dashboard" });
  const settings = footer.getByRole("button", { name: "Settings", exact: true });

  await expect(footer).toBeVisible();
  await expect(dashboard).toBeVisible();
  await expect(settings).toBeVisible();

  const dashboardBox = await dashboard.boundingBox();
  const settingsBox = await settings.boundingBox();
  expect(dashboardBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(dashboardBox!.y).toBeLessThan(settingsBox!.y);
});
