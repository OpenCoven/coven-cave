import { expect, test, type Locator, type Page } from "@playwright/test";

// #5956 (G2): on a desktop window too narrow for the nav, the Chat list and a
// readable conversation together, the open nav yields to the list for the
// visit. Wide windows keep it. Reopening wins; leaving Chat gives it back. The
// policy itself is unit-tested in src/lib/shell-chat-rail-nav.test.ts.

async function seedOpenSidebar(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "1");
    window.localStorage.setItem("cave:shell:nav-open:source", "user");
    window.localStorage.setItem("cave:chat-rail:open", "true");
  });
}

// aria-expanded follows the panel's measured width a frame later, so poll the
// pair until the panel has stopped moving (same idiom as sidebar-hidden-push).
async function expectNavSettled(page: Page, expected: "open" | "closed") {
  const toggle = page.locator(".shell-top-toggle--nav");
  const navPanel = page.locator(".shell-nav-panel");
  await expect
    .poll(async () => {
      const expanded = await toggle.getAttribute("aria-expanded");
      const width = (await navPanel.boundingBox())?.width ?? (expected === "open" ? 0 : 1);
      return expected === "open"
        ? expanded === "true" && width >= 220
        : expanded === "false" && width <= 1;
    })
    .toBe(true);
}

function sidebarRow(page: Page, label: string): Locator {
  return page
    .locator(".shell-nav button.sidebar-folder-row")
    .filter({ has: page.locator(".sidebar-folder-label", { hasText: new RegExp(`^${label}$`) }) });
}

async function openHome(page: Page) {
  await page.goto("/?demo=1");
  await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
  await expectNavSettled(page, "open");
}

// Keyboard entry: the focus starts on the sidebar row the nav is about to hide.
async function enterChatByKeyboard(page: Page) {
  const chatRow = sidebarRow(page, "Chat");
  await chatRow.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("aside.chat-inner-rail")).toBeVisible({ timeout: 30_000 });
}

function focusIsInMain(page: Page) {
  return page.evaluate(() => {
    const main = document.getElementById("shell-main-content");
    const active = document.activeElement;
    return Boolean(main && active && active !== document.body && main.contains(active));
  });
}

function rememberedNavOpen(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("cave:shell:nav-open"));
}

// Two animation frames: long enough for the shell's list-visibility effect and
// the panel's ResizeObserver to have acted on the last announcement.
function nextFrames(page: Page) {
  return page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

test.describe("Chat list fit on a narrow desktop window", () => {
  test.skip(({ isMobile }) => isMobile, "the phone nav is a drawer");
  test.use({ viewport: { width: 1100, height: 800 } });

  test("entering Chat from the sidebar yields the nav, keeps focus in the page, and never rewrites the preference", async ({ page }) => {
    await seedOpenSidebar(page);
    await openHome(page);

    await enterChatByKeyboard(page);
    await expectNavSettled(page, "closed");
    await expect(page.locator(".shell-nav")).toHaveAttribute("aria-hidden", "true");
    await expect.poll(() => focusIsInMain(page)).toBe(true);
    expect(await rememberedNavOpen(page)).toBe("1");
    // The yield is not the retired icon rail: the closed nav takes no width.
    await expect(page.locator(".shell-nav--rail, .shell-nav--peek")).toHaveCount(0);
  });

  test("launching straight into Chat yields the restored nav and keeps it closed once startup settles", async ({ page }) => {
    await seedOpenSidebar(page);
    await page.goto("/?demo=1&mode=chat");
    await expect(page.locator("aside.chat-inner-rail")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
    await expectNavSettled(page, "closed");
    // The settled remembered-preference pass must not reopen it.
    await nextFrames(page);
    await expectNavSettled(page, "closed");
    expect(await rememberedNavOpen(page)).toBe("1");
  });

  test("reopening the nav from the keyboard wins for the rest of the visit", async ({ page }) => {
    await seedOpenSidebar(page);
    await openHome(page);
    await enterChatByKeyboard(page);
    await expectNavSettled(page, "closed");

    const toggle = page.locator(".shell-top-toggle--nav");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expectNavSettled(page, "open");
    // Switching Chat tabs re-announces the list; the nav must not be taken again.
    const tabs = page.getByRole("tablist", { name: "Chat sections" });
    await tabs.getByRole("tab", { name: "Projects", exact: true }).click();
    await tabs.getByRole("tab", { name: "Chats", exact: true }).click();
    await expect(page.locator("aside.chat-inner-rail")).toBeVisible();
    await nextFrames(page);
    await expectNavSettled(page, "open");
    expect(await rememberedNavOpen(page)).toBe("1");
  });

  test("leaving Chat gives the nav back", async ({ page }) => {
    await seedOpenSidebar(page);
    await openHome(page);
    await enterChatByKeyboard(page);
    await expectNavSettled(page, "closed");

    const back = page.locator(".shell-top-history").getByRole("button", { name: "Go back" });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("aside.chat-inner-rail")).toHaveCount(0);
    await expectNavSettled(page, "open");
    expect(await rememberedNavOpen(page)).toBe("1");
  });

  test("collapsing the Chat list gives the nav back", async ({ page }) => {
    await seedOpenSidebar(page);
    await openHome(page);
    await enterChatByKeyboard(page);
    await expectNavSettled(page, "closed");

    await page.locator("aside.chat-inner-rail").getByRole("button", { name: "Collapse chat list" }).click();
    await expect(page.getByRole("button", { name: "Expand chat list" })).toBeVisible();
    await expectNavSettled(page, "open");
  });
});

test.describe("Chat list fit on a wide desktop window", () => {
  test.skip(({ isMobile }) => isMobile, "the phone nav is a drawer");
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the open nav stays: it costs the reading column little or nothing here", async ({ page }) => {
    await seedOpenSidebar(page);
    await openHome(page);
    await enterChatByKeyboard(page);
    await nextFrames(page);
    await expectNavSettled(page, "open");
    expect(await rememberedNavOpen(page)).toBe("1");
  });
});
