import { expect, test, type Page } from "@playwright/test";

// Browser Back must restore the page a history entry belongs to (#6442).
//
// Next's app router marks every entry it can restore with `__NA` and ignores a
// popstate to an entry without it. Workspace strips `?mode=` in a mount effect,
// and React runs that child effect before the AppRouter effect that wraps
// history.replaceState. A raw `replaceState(null, …)` there wiped the Home
// entry's markers, so Back from Settings changed the address to `/` while
// Settings stayed on screen.
//
// The defect needs Workspace in the hydration commit, which is what an
// onboarded user gets: page.tsx server-renders WorkspaceApp once the
// `cave_onboarding_dismissed` cookie is set (or setup is complete). Without the
// cookie the e2e bootstrap shows the onboarding gate first, Workspace mounts
// after Next has wrapped history, and the defect hides. Keep the cookie.
//
// Listed in MOBILE_SURFACE_SPECS so it runs on desktop, Pixel 5 and iPhone 13.
// Daemon-less (COVEN_CAVE_E2E=1): the roster and session list are page.route
// mocks.

const FAMILIARS = {
  ok: true,
  familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }],
};

async function openHomeFromModeLink(page: Page, options: { sidebarOpen?: boolean } = {}) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("history-state-restore needs the configured baseURL for its onboarding cookie");
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", url: baseURL }]);
  await page.addInitScript((sidebarOpen) => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "home");
    if (sidebarOpen) {
      window.localStorage.setItem("cave:shell:nav-open", "1");
      window.localStorage.setItem("cave:shell:nav-open:source", "user");
    }
  }, options.sidebarOpen ?? false);
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: FAMILIARS }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.goto("/?mode=home");
  await expect(home(page)).toBeVisible({ timeout: 45_000 });
  // Workspace has consumed the deep link and stripped it from the address.
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe("");
}

const home = (page: Page) => page.locator(".home-composer-root");
const settings = (page: Page) => page.locator(".settings-shell");
const pathname = (page: Page) => page.evaluate(() => window.location.pathname);

async function expectSettings(page: Page) {
  await expect.poll(() => pathname(page)).toBe("/settings");
  await expect(settings(page)).toBeVisible({ timeout: 20_000 });
}

async function expectHome(page: Page) {
  await expect.poll(() => pathname(page)).toBe("/");
  await expect(settings(page)).toBeHidden({ timeout: 20_000 });
  await expect(home(page)).toBeVisible();
}

test.describe("history entries stay restorable", () => {
  test("stripping ?mode= on load keeps the Home entry's router markers", async ({ page }) => {
    await openHomeFromModeLink(page);
    await expect
      .poll(() => page.evaluate(() => (window.history.state as { __NA?: unknown } | null)?.__NA ?? null))
      .toBe(true);
  });

  test("Back from Settings opened with the shortcut shows Home, and Forward returns", async ({ page }) => {
    await openHomeFromModeLink(page);
    await page.keyboard.press("ControlOrMeta+Comma");
    await expectSettings(page);

    await page.goBack();
    await expectHome(page);

    await page.goForward();
    await expectSettings(page);
  });

  test("Back from Settings opened with the Settings button shows Home, and Forward returns", async ({ page }) => {
    // Desktop's Settings button lives in the sidebar footer; phones show it in
    // the top bar.
    await openHomeFromModeLink(page, { sidebarOpen: test.info().project.name === "desktop" });
    await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).first().click();
    await expectSettings(page);

    await page.goBack();
    await expectHome(page);

    await page.goForward();
    await expectSettings(page);
  });
});
