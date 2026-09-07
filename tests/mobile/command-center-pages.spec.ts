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

// cave-vkb2d: the mobile composer dock is position:sticky;bottom:0 (with a
// transform transition driven by --composer-kb-offset), and its containing
// surface keeps settling after .cave-chat-linear appears — CI has measured
// the SAME dock at bottom 663.5 (under the bottom tabs) on one run and at
// 348.9/406.9 on identical others, all from reading the box immediately
// after waitForSelector. Poll until the dock's bottom edge holds still for a
// continuous 400ms before asserting on geometry, so the assertion sees the
// settled sticky state rather than a mid-layout box.
async function waitForComposerSettled(page: Page) {
  await expect.poll(
    () =>
      page.evaluate(() => {
        const dock = document.querySelector<HTMLElement>(".cave-composer-dock");
        if (!dock) return false;
        const settle = (window as unknown as { __caveVkb2dComposerSettle?: { bottom: number; since: number } })
          .__caveVkb2dComposerSettle ??= { bottom: Number.NaN, since: 0 };
        const bottom = dock.getBoundingClientRect().bottom;
        const now = performance.now();
        if (Number.isNaN(settle.bottom) || Math.abs(bottom - settle.bottom) > 0.5) {
          settle.bottom = bottom;
          settle.since = now;
          return false;
        }
        return now - settle.since >= 400;
      }),
    {
      message: "composer dock should settle into its sticky position before measuring",
      timeout: 10_000,
    },
  ).toBe(true);
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
      // startWorkspaceChat gates on a SELECTED project, not merely an available
      // one: with cave:workspace:project-scope:v1 unset it announces "Choose a
      // project before starting a chat" and returns, so the New session tap
      // below never reaches a chat detail. Restoring a scope keeps the gate shut.
      window.localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("p1"));
    });
    // CI has no daemon — drive the surfaces from mocked API responses.
    await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }));
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
    // Starting a chat now runs through the project gate in startWorkspaceChat:
    // with no accessible project it announces "Choose a project before starting
    // a chat" and returns, so the tap below would never reach a chat detail.
    // Serving one writable project keeps the gate shut — same fix already
    // carried by chat-boot-landing.spec.ts. This spec is about phone geometry,
    // not project selection.
    await page.route("**/api/projects**", (route) =>
      route.fulfill({ json: { ok: true, projects: [{ id: "p1", name: "Queue", root: "/repo/queue", access: "write" }] } }));
    await page.goto("/");
    await page.waitForSelector(".mobile-bottom-tabs");
  });

  test("Chat index and new chat detail keep stable mobile geometry", async ({ page }) => {
    // Scoped to the bottom tabs: the siderail's NavSectionTabs now renders a
    // second role="tab" named "Chat" (NAV_SECTIONS id "code"), so the bare
    // name matches two elements. This spec is about phone geometry and its
    // beforeEach already waits for .mobile-bottom-tabs — that is the tab it
    // has always meant.
    await page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "Chat", exact: true }).click();
    await page.waitForSelector(".chat-surface");

    await expectNoHorizontalOverflow(page, "Chat index");

    // The standalone Chat page no longer renders a `.chat-scope-tabs` header
    // strip (the Chat/Code toggle was removed) — it's just the conversation, so
    // there's no toggle-row geometry to assert here.
    const topBar = await box(page, ".top-bar");

    // cave-n3jg2: the two conditional "+ Session" CTAs (identity row, filter
    // row) collapsed into one "New session" button in the surface title row.
    await page.locator(".chat-surface").getByRole("button", { name: "New session", exact: true }).first().click();
    await page.waitForSelector(".cave-chat-linear");

    // The dock is sticky and its surface is still settling at this point —
    // wait for the composer geometry to hold still before measuring it.
    await waitForComposerSettled(page);

    await expectNoHorizontalOverflow(page, "Chat detail");

    const header = await box(page, ".cave-chat-linear-header");
    const composer = await box(page, ".cave-composer-dock");
    const detailTabs = await box(page, ".mobile-bottom-tabs");

    expect(header.top, "Chat detail header should stay below the app top bar").toBeGreaterThanOrEqual(topBar.bottom - 1);
    expect(composer.bottom, "Composer should stay above the mobile bottom tabs").toBeLessThanOrEqual(detailTabs.top + 1);
  });

  test("Auto selects autonomous mission mode and gives the chat a visible aura", async ({ page }) => {
    await page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "Chat", exact: true }).click();
    await page.waitForSelector(".chat-surface");
    await page.locator(".chat-surface").getByRole("button", { name: "New session", exact: true }).first().click();

    const chat = page.locator(".cave-chat-linear");
    const composer = page.locator(".cave-composer-input");
    const auto = page.locator(".cave-mobile-action-chip--auto");
    const baseButtonBackground = await auto.evaluate((element) => getComputedStyle(element).backgroundColor);

    await expect(auto).toHaveAccessibleName("Select Auto mode");
    await expect(auto).toHaveAttribute("aria-pressed", "false");
    await auto.click();

    await expect(composer).toHaveValue("/auto ");
    await expect(auto).toHaveAccessibleName("Leave Auto mode");
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    await expect(chat).toHaveAttribute("data-auto-mode", "selected");
    await expect.poll(
      () => auto.evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe(baseButtonBackground);

    await composer.fill("/auto finish the mobile polish");
    await auto.click();
    await expect(composer).toHaveValue("finish the mobile polish");
    await expect(auto).toHaveAccessibleName("Select Auto mode");
    await expect(auto).toHaveAttribute("aria-pressed", "false");
    await expect(chat).not.toHaveAttribute("data-auto-mode");
  });
});
