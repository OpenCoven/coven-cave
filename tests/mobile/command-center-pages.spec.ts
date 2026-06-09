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
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:active-familiar", "nova");
    });
    await page.goto("/");
    await page.waitForSelector(".mobile-bottom-tabs");
  });

  test("Library uses a full-width mobile list instead of squeezed desktop panes", async ({ page }) => {
    await page.getByRole("tab", { name: "Library" }).click();
    await page.waitForSelector(".library-shell");

    await expectNoHorizontalOverflow(page, "Library");

    await expect(page.locator(".library-preview").first()).toBeHidden();

    const list = await box(page, ".library-list-panel");
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

    await page.locator(".chat-scope-tabs button").filter({ hasText: /^\s*New\s*$/ }).click();
    await page.waitForSelector(".cave-chat-linear");

    await expectNoHorizontalOverflow(page, "Chat detail");

    const header = await box(page, ".cave-chat-linear-header");
    const composer = await box(page, ".cave-composer-dock");
    const detailTabs = await box(page, ".mobile-bottom-tabs");

    expect(header.top, "Chat detail header should stay below the app top bar").toBeGreaterThanOrEqual(topBar.bottom - 1);
    expect(composer.bottom, "Composer should stay above the mobile bottom tabs").toBeLessThanOrEqual(detailTabs.top + 1);
  });
});
