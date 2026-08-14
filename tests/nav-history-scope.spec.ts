import { expect, test, type Page } from "@playwright/test";

// Back and Forward step in-surface navigation one level at a time.
//
// Chat's scope strip (Sessions / Projects / Canvas / Familiar) used to be plain
// component state, so Back from Canvas left the whole surface instead of
// returning to Projects. These specs pin the traversal, the button enabled
// states — the shell renders both controls as `disabled={!canGo*}`, which is how
// the Forward regression stayed invisible — and the truncation rule.
//
// Daemon-less (COVEN_CAVE_E2E=1): onboarding is dismissed via localStorage and
// every surface is driven through page.route mocks.

const FAMILIARS = {
  ok: true,
  familiars: [
    { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
  ],
};

async function gotoChat(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: FAMILIARS }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.goto("/?mode=chat");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  await page.locator(".chat-surface").waitFor({ state: "visible", timeout: 30_000 });
}

const scopeTab = (page: Page, name: string) =>
  page.getByRole("tablist", { name: "Chat sections" }).getByRole("tab", { name, exact: true });

const backButton = (page: Page) => page.getByRole("button", { name: "Go back" });
const forwardButton = (page: Page) => page.getByRole("button", { name: "Go forward" });

async function expectTab(page: Page, name: string) {
  await expect(scopeTab(page, name)).toHaveAttribute("aria-selected", "true");
}

test.describe("scope strip history", () => {
  test("Back steps up one tab at a time, and Forward retraces", async ({ page }) => {
    await gotoChat(page);
    await expectTab(page, "Sessions");

    await scopeTab(page, "Projects").click();
    await expectTab(page, "Projects");
    await scopeTab(page, "Canvas").click();
    await expectTab(page, "Canvas");

    await backButton(page).click();
    await expectTab(page, "Projects");
    await backButton(page).click();
    await expectTab(page, "Sessions");

    await forwardButton(page).click();
    await expectTab(page, "Projects");
    await forwardButton(page).click();
    await expectTab(page, "Canvas");
  });

  test("Forward enables after a Back", async ({ page }) => {
    // The regression this pins: traversal changed the journal without notifying
    // the store the shell reads, so Forward stayed disabled forever.
    await gotoChat(page);
    await expect(forwardButton(page)).toBeDisabled();

    await scopeTab(page, "Projects").click();
    await expect(backButton(page)).toBeEnabled();

    await backButton(page).click();
    await expectTab(page, "Sessions");
    await expect(forwardButton(page)).toBeEnabled();
  });

  test("a new pick from a rewound position drops the forward trail", async ({ page }) => {
    await gotoChat(page);
    await scopeTab(page, "Projects").click();
    await scopeTab(page, "Canvas").click();
    await backButton(page).click();
    await expectTab(page, "Projects");

    await scopeTab(page, "Familiar").click();
    await expect(forwardButton(page)).toBeDisabled();

    await backButton(page).click();
    await expectTab(page, "Projects");
  });
});
