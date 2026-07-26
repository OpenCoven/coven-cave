import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 320, height: 800 } });

test("About update recovery stays reachable in a narrow coarse-pointer pane", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });
  await page.route("**/api/app/latest-release", (route) =>
    route.fulfill({
      json: {
        current: "0.2.0",
        latest: "9.9.9",
        available: true,
        url: "https://github.com/OpenCoven/coven-cave/releases/tag/v9.9.9",
        checkedAt: new Date().toISOString(),
      },
    }),
  );
  await page.goto("/settings#about");

  const row = page.locator(".settings-about-update-row");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText(/Native updater unavailable|Update v9\.9\.9/);

  const layout = await row.evaluate((element) => {
    const actions = element.querySelector<HTMLElement>(
      ".settings-about-update-actions",
    );
    const buttons = [...element.querySelectorAll<HTMLElement>(".ui-btn")];
    return {
      rowDirection: getComputedStyle(element).flexDirection,
      actionsWrap: actions ? getComputedStyle(actions).flexWrap : null,
      actionsFits: actions
        ? actions.scrollWidth <= actions.clientWidth
        : false,
      rowFits: element.scrollWidth <= element.clientWidth,
      buttonTargets: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    };
  });

  expect(layout.rowDirection).toBe("column");
  expect(layout.actionsWrap).toBe("wrap");
  expect(layout.actionsFits).toBe(true);
  expect(layout.rowFits).toBe(true);
  expect(layout.buttonTargets.length).toBeGreaterThanOrEqual(2);
  for (const target of layout.buttonTargets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
});
