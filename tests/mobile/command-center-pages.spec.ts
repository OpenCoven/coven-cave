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
    });
    // CI has no daemon — drive the surfaces from mocked API responses.
    await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }));
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
    await page.goto("/");
    await page.waitForSelector(".mobile-bottom-tabs");
  });

  test("Chat index and new chat detail keep stable mobile geometry", async ({ page }) => {
    await page.getByRole("tab", { name: "Chat" }).click();
    await page.waitForSelector(".chat-surface");

    await expectNoHorizontalOverflow(page, "Chat index");

    // The standalone Chat page no longer renders a `.chat-scope-tabs` header
    // strip (the Chat/Code toggle was removed) — it's just the conversation, so
    // there's no toggle-row geometry to assert here.
    const topBar = await box(page, ".top-bar");

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
