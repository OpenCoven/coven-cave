import { expect, test } from "@playwright/test";
import { BUILT_IN_WORKSPACE_PAGE_IDS } from "../../src/lib/workspace-page-registry";

for (const pageId of BUILT_IN_WORKSPACE_PAGE_IDS) {
  test(`${pageId} uses the container-width tab fallback`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });

    const reference = pageId === "home" ? "board" : "home";
    await page.goto(
      `/?demo=1&mode=${encodeURIComponent(pageId)}&split=${encodeURIComponent(reference)}&splitSide=right`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    const tabs = page.locator('.split-host__mobile-switcher[role="tablist"]');
    await expect(tabs).toBeVisible({ timeout: 60_000 });
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    const panels = await page.locator(".split-host__group > [data-panel]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          active: node.getAttribute("data-active") === "true",
          width: rect.width,
          height: rect.height,
        };
      }),
    );
    expect(panels.filter((panel) => panel.active)).toHaveLength(1);
    expect(panels.filter((panel) => !panel.active).every((panel) => panel.width === 0 || panel.height === 0)).toBe(true);
  });
}
