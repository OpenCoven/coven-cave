import { expect, test, type Page } from "@playwright/test";

async function box(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      display: style.display,
    };
  });
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} should not overflow horizontally`).toBeLessThanOrEqual(1);
}

test.describe("mobile command center pages", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // This spec asserts phone geometry against the mobile bottom-tab chrome,
    // which only renders under the mobile breakpoint — skip it on the desktop
    // project (the pixel-5 / iphone-13 projects cover it).
    test.skip(testInfo.project.name === "desktop", "mobile-only: requires .mobile-bottom-tabs");
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:active-familiar", "nova");
      // On a fresh profile (CI) the onboarding overlay covers the app and
      // intercepts pointer events — dismiss it so the shell is interactive.
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
      // CI has no daemon, so drive the surfaces from self-contained demo data
      // (same approach as the other chat specs) instead of a live backend.
      window.localStorage.setItem("cave:demo-mode", "1");
    });
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
    await page.goto("/?demo=1");
    await page.waitForSelector(".mobile-bottom-tabs");
  });

  test("Library uses a full-width mobile list instead of squeezed desktop panes", async ({ page }) => {
    await page.getByRole("tab", { name: "Library" }).click();
    await page.waitForSelector(".library-shell");

    await expectNoHorizontalOverflow(page, "Library");

    await expect(page.locator(".library-preview").first()).toBeHidden();

    const list = await box(page, ".library-list-panel, .library-browse-canvas");
    const rail = await box(page, ".library-rail");

    expect(list.width, "Library list should claim the phone width").toBeGreaterThanOrEqual(340);
    expect(rail.width, "Library section rail should span the phone width").toBeGreaterThanOrEqual(340);
    expect(list.top, "Library list should sit below the mobile section strip").toBeGreaterThanOrEqual(rail.bottom - 1);
  });

  test("Chat index and new chat detail keep stable mobile geometry", async ({ page }) => {
    await page.getByRole("tab", { name: "Chat" }).click();
    await page.waitForSelector(".chat-surface");

    await expectNoHorizontalOverflow(page, "Chat index");

    const topBar = await box(page, ".top-bar");
    const chatTabs = await box(page, ".chat-scope-tabs");
    const bottomTabs = await box(page, ".mobile-bottom-tabs");

    expect(chatTabs.top, "Chat tabs should sit below the app top bar").toBeGreaterThanOrEqual(topBar.bottom - 1);
    expect(chatTabs.bottom, "Chat tabs should not run into bottom tabs").toBeLessThan(bottomTabs.top);

    await page.locator(".chat-surface").getByRole("button", { name: "Session", exact: true }).first().click();
    await page.waitForSelector(".cave-chat-linear");

    await expectNoHorizontalOverflow(page, "Chat detail");

    const header = await box(page, ".cave-chat-linear-header");
    const composer = await box(page, ".cave-composer-dock");
    const detailTabs = await box(page, ".mobile-bottom-tabs");

    expect(header.top, "Chat detail header should stay below the app top bar").toBeGreaterThanOrEqual(topBar.bottom - 1);
    expect(composer.bottom, "Composer should stay above the mobile bottom tabs").toBeLessThanOrEqual(detailTabs.top + 1);
  });
});
