import { expect, test, type Page } from "@playwright/test";

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
      const openNav = page.getByRole("button", { name: "Open navigation (⌘B)" });
      if (await openNav.isVisible().catch(() => false)) await openNav.click();
    }
    // The Chat row lives in the Code section of the rail (cave-24d2r); when the
    // Home section is open, the Code tab is the way in.
    if (await chatDestination.isVisible().catch(() => false)) {
      await chatDestination.click();
    } else {
      await nav.getByRole("tab", { name: "Code", exact: true }).first().click();
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
  await expect(settings.getByRole("tablist", { name: "Familiar settings" })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Identity", exact: true })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Memory", exact: true })).toBeVisible();
  await expect(settings.getByText("Tune Familiar 01 without leaving Chat.")).toBeVisible();

  await settings.getByRole("tab", { name: "Memory", exact: true }).click();
  await expect(settings.getByRole("tab", { name: "Memory", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
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
