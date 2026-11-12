import { expect, test } from "@playwright/test";

// #6241: in the mobile picker the section list must shrink and scroll, so the
// footer hint never sits over the last row. On an iPhone 13 the list used to
// overflow its column and About stayed half-covered with nothing to scroll.
test("the Settings picker scrolls its last section clear of the footer", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.goto("/settings");

  const picker = page.locator("nav.settings-shell__sidebar");
  const footer = page.getByText("Tap a section to open", { exact: true });
  const lastRow = picker.getByRole("button", { name: "About", exact: true });
  await expect(footer).toBeVisible({ timeout: 30_000 });
  await expect(lastRow).toBeVisible();

  await picker.evaluate((nav) => {
    nav.scrollTop = nav.scrollHeight;
  });

  const layout = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>("nav.settings-shell__sidebar");
    const about = [...(nav?.querySelectorAll<HTMLElement>("button") ?? [])].find(
      (button) => button.textContent?.trim() === "About",
    );
    const hint = [...document.querySelectorAll<HTMLElement>("footer")].find(
      (element) => element.textContent?.trim() === "Tap a section to open",
    );
    return {
      aboutBottom: about?.getBoundingClientRect().bottom ?? Number.NaN,
      footerTop: hint?.getBoundingClientRect().top ?? Number.NaN,
      navBottom: nav?.getBoundingClientRect().bottom ?? Number.NaN,
    };
  });

  expect(layout.aboutBottom).toBeLessThanOrEqual(layout.footerTop);
  expect(layout.navBottom).toBeLessThanOrEqual(layout.footerTop);
});
