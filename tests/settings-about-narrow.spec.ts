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
  await expect(row).toContainText(
    /Native updater unavailable|Update v9\.9\.9/,
    { timeout: 30_000 },
  );

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


test("release notes stay readable and blocked browser handoff is actionable", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.open = () => null;
    window.addEventListener("cave:open-url-in-browser", () => {
      document.documentElement.dataset.unexpectedEmbeddedHandoff = "true";
    });
  });
  const notes = "Release ✓\n<script>window.unsafeNotes = true</script>\n" + "long-path/".repeat(80);
  await page.route("**/api/app/latest-release", route => route.fulfill({ json: {
    current: "0.2.0", latest: "9.9.9", available: true, notes,
    url: "https://github.com/OpenCoven/coven-cave/releases/tag/v9.9.9",
    checkedAt: "2026-10-20T00:00:00.000Z",
  } }));
  await page.goto("/settings#about");
  const row = page.locator(".settings-about-update-row");
  const disclosure = row.locator("summary");
  await expect(disclosure).toHaveText("Release notes");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  const content = row.getByRole("region", { name: "Release notes" });
  await expect(content).toBeVisible();
  await expect(content).toHaveText(notes);
  await content.focus();
  await expect(content).toBeFocused();
  expect(await page.evaluate(() => (window as Window & { unsafeNotes?: boolean }).unsafeNotes)).toBeUndefined();
  for (const width of [320, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
      await page.evaluate(({ theme, mode }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.mode = mode;
      }, { theme, mode });
      const screenshot = testInfo.outputPath(`release-notes-${width}-${theme}-${mode}.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach(`release-notes-${width}-${theme}-${mode}`, {
        path: screenshot, contentType: "image/png",
      });
    }
  }
  await row.getByRole("button", { name: "Open installer in system browser" }).click();
  const warning = page.locator(".shell-banner").filter({ hasText: "Couldn't open system browser" });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await warning.locator("summary").click();
  await expect(warning.locator("code")).toHaveText("https://github.com/OpenCoven/coven-cave/releases/tag/v9.9.9");
  expect(await page.evaluate(() => document.documentElement.dataset.unexpectedEmbeddedHandoff)).toBeUndefined();
});
