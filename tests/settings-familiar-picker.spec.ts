import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const FAMILIARS = Array.from({ length: 60 }, (_, index) => ({
  id: `familiar-${String(index + 1).padStart(2, "0")}`,
  display_name: `Familiar ${String(index + 1).padStart(2, "0")}`,
  role: index % 2 === 0 ? "Builder" : "Researcher",
  color: index % 2 === 0 ? "#8b7cf6" : "#57b8a6",
  icon: index % 2 === 0 ? "ph:sparkle-fill" : "ph:owl-fill",
  status: "active",
}));

async function gotoChatFamiliarSettings(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:familiar-scope", JSON.stringify(["familiar-01"]));
    window.localStorage.setItem("cave:active-familiar", "familiar-01");
  });
  // This migration path only needs the roster and session shape below. Abort
  // unrelated daemon-backed API reads so Cave-home reconciliation cannot hold
  // the Chat shell behind a live runtime lock in the full CI suite.
  await page.route("**/api/**", (route) => route.abort());
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: FAMILIARS } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.goto("/?mode=chat");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  const surface = page.locator(".chat-surface");
  try {
    await surface.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const nav = page.locator('aside[aria-label="Sidebar"]');
    const chatDestination = nav.getByRole("button", { name: /^Chat\b/ }).first();
    if (!(await chatDestination.isVisible().catch(() => false))) {
      const openNav = page.getByRole("button", { name: /^Open navigation \((?:⌘|Ctrl\+)B\)$/ });
      if (await openNav.isVisible().catch(() => false)) await openNav.click();
    }
    // The Chat row lives in the rail's second section (cave-24d2r); when the
    // Home section is open, that section's tab is the way in. Its LABEL is
    // "Chat" while its id stays "code" (NAV_SECTIONS) — flipped from "Code" by
    // fix/cave-vqh94-home-chat-tabs. Same copy of this helper as the one in
    // chat-sidebar-nav.spec.ts; both were waiting for a name that is gone.
    if (await chatDestination.isVisible().catch(() => false)) {
      await chatDestination.click();
    } else {
      await nav.getByRole("tab", { name: "Chat", exact: true }).first().click();
    }
    await surface.waitFor({ state: "visible", timeout: 30_000 });
  }
  const chatSections = page.getByRole("tablist", { name: "Chat sections" });
  await expect(chatSections).toBeVisible({ timeout: 60_000 });
  await chatSections.getByRole("tab", { name: "Familiar", exact: true }).click();
  const familiarSections = page.getByRole("tablist", { name: "Familiar sections" });
  await expect(familiarSections).toBeVisible({ timeout: 60_000 });
  const settingsTab = familiarSections.getByRole("tab", { name: "Settings", exact: true });
  await expect(settingsTab).toBeVisible({ timeout: 60_000 });
  await settingsTab.click();
  await expect(
    page.getByRole("region", { name: "Settings for Familiar 01" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function emulateVisualViewport(page: Page, width: number, height: number) {
  await page.addInitScript(
    ({ visualWidth, visualHeight }) => {
      const viewport = Object.assign(new EventTarget(), {
        width: visualWidth,
        height: visualHeight,
        offsetTop: 0,
        offsetLeft: 0,
        pageTop: 0,
        pageLeft: 0,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
    },
    { visualWidth: width, visualHeight: height },
  );
}

test("Chat Familiar Settings remains reachable in a keyboard-shrunk viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await emulateVisualViewport(page, 390, 270);
  await gotoChatFamiliarSettings(page);

  const settings = page.getByRole("region", { name: "Settings for Familiar 01" });
  const panel = page.locator(".familiar-tab__main");
  await expect(panel).toHaveAttribute("data-short-viewport", "true");
  const section = settings.getByRole("combobox", { name: "Settings section" });
  await expect(section).toBeVisible();
  await section.focus();
  await expect(section).toBeFocused();
  const bounds = await section.boundingBox();
  const visualViewport = await page.evaluate(() => ({
    top: window.visualViewport!.offsetTop,
    bottom: window.visualViewport!.offsetTop + window.visualViewport!.height,
  }));
  expect(bounds!.y).toBeGreaterThanOrEqual(visualViewport.top);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(visualViewport.bottom);
  await expect(section).toHaveValue("identity");
  await expect(section.locator("option")).toHaveText(["Identity", "Brain", "Memory", "Vault", "Chat"]);
  await expect(settings.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();

  const name = settings.getByRole("textbox", { name: "Display name", exact: true });
  await name.fill("Keyboard draft");
  const inputBounds = await name.boundingBox();
  expect(inputBounds!.y).toBeGreaterThanOrEqual(visualViewport.top);
  expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(visualViewport.bottom);
  const resizeVisualViewport = (height: number) => page.evaluate(nextHeight => {
    Object.assign(window.visualViewport!, { height: nextHeight });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  }, height);
  // iOS may also pan the visual viewport after opening the keyboard.
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { offsetTop: 200 });
    window.visualViewport!.dispatchEvent(new Event("scroll"));
  });
  await section.focus();
  await expect.poll(async () => (await section.boundingBox())!.y).toBeGreaterThanOrEqual(200);
  const pannedBounds = await section.boundingBox();
  expect(pannedBounds!.y + pannedBounds!.height).toBeLessThanOrEqual(470);
  await name.focus();
  const pannedInput = await name.boundingBox();
  expect(pannedInput!.y).toBeGreaterThanOrEqual(200);
  expect(pannedInput!.y + pannedInput!.height).toBeLessThanOrEqual(470);
  await page.evaluate(() => { Object.assign(window.visualViewport!, { offsetTop: 0 }); });
  await resizeVisualViewport(720);
  await expect(panel).not.toHaveAttribute("data-short-viewport", "true");
  await expect(name).toHaveValue("Keyboard draft");
  const body = settings.locator(".familiar-tab__settings-body");
  const savedScroll = await body.evaluate(element => {
    element.scrollTop = 80;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollTop;
  });
  expect(savedScroll).toBeGreaterThan(0);
  await resizeVisualViewport(270);
  await expect(panel).toHaveAttribute("data-short-viewport", "true");
  await resizeVisualViewport(720);
  await expect(panel).not.toHaveAttribute("data-short-viewport", "true");
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(savedScroll);
  await expect(name).toHaveValue("Keyboard draft");

  await section.selectOption("memory");
  await expect(section).toHaveValue("memory");
  await expect(settings.getByRole("heading", { name: "Memory", exact: true })).toBeVisible();
});

test("the migrated Familiar Settings surface keeps its nested controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoChatFamiliarSettings(page);

  const settings = page.getByRole("region", { name: "Settings for Familiar 01" });
  await expect(settings.getByRole("tab", { name: "Chat", exact: true })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Brain", exact: true })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Memory", exact: true })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Vault", exact: true })).toBeVisible();

  await settings.getByRole("tab", { name: "Vault", exact: true }).click();
  await expect(settings.getByRole("tab", { name: "Vault", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the retired Settings route no longer exposes the familiar roster", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars", (route) =>
    route.fulfill({ json: { ok: true, familiars: FAMILIARS } }),
  );
  await page.goto("/settings#familiars");
  await expect(page.getByRole("complementary", { name: "Familiar roster" })).toHaveCount(0);
});
