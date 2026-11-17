import { expect, test } from "@playwright/test";
import { setup } from "./chat-context-fixture";

test("reference rail keeps named navigation and a true closed state at desktop widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  // Browser coverage of the native CSS only; real window behavior is a
  // separate native acceptance row, never inferred from this marker.
  await page.evaluate(() => {
    document.documentElement.dataset.tauriTitlebar = "";
    document.documentElement.dataset.trafficLights = "visible";
  });
  const nav = page.locator(".shell-nav-panel");
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(48);
  await expect.poll(async () => Math.round((await nav.locator("..").boundingBox())!.width)).toBe(48);
  await expect.poll(() => page.locator(".shell-root").evaluate((node) =>
    parseFloat(getComputedStyle(node).getPropertyValue("--shell-nav-chrome-width")),
  )).toBeCloseTo(48, 0);
  const primary = page.getByRole("navigation", { name: "Primary", exact: true });
  const home = primary.getByRole("button", { name: "Home", exact: true });
  await expect(home).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("reference-desktop-preview.png") });
  await home.focus();
  await page.keyboard.press("ArrowDown");
  await expect(primary.getByRole("button", { name: "Chat", exact: true })).toBeFocused();
  await expect(primary.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(primary.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  const scopeLabels = page.locator(".workspace-titlebar-context :is(.cave-project-picker__trigger-label, .familiar-switcher__trigger-label)");
  const expectShortScopeLabelsFit = async () => {
    for (const label of await scopeLabels.all()) {
      await expect.poll(() => label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
  };
  await expectShortScopeLabelsFit();
  await page.screenshot({ path: test.info().outputPath("reference-rail-dark.png") });

  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(0);
  await expect(primary).toBeHidden();
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(48);

  for (const appearance of ["light", "tide", "dark"]) {
    await page.evaluate((appearance) => {
      document.documentElement.dataset.mode = appearance === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = appearance === "tide" ? "tide" : "coven";
    }, appearance);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(48);
    const body = await page.locator(".shell-body").boundingBox();
    expect(body!.y).toBeGreaterThanOrEqual(48);
    expect(body!.y + body!.height).toBeLessThanOrEqual(768);
    const project = page.locator(".workspace-titlebar-context").getByRole("button", { name: /^Switch project:/ });
    const box = await project.boundingBox();
    expect(box!.width).toBeGreaterThan(40);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
    await expectShortScopeLabelsFit();
    await project.click();
    await expect(page.locator(".cave-project-picker__row").filter({ hasText: "Context alpha" }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(project).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`reference-rail-narrow-${appearance}.png`) });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await home.focus();
  await expect(home).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("reference-rail-focus-reduced-motion.png") });

  for (const open of [true, false]) {
    if (!open) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
    await page.setViewportSize({ width: 1023, height: 768 });
    await expect(page.locator(".workspace-titlebar-context")).toBeHidden();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(open ? 48 : 0);
    await expect(page.getByRole("button", { name: open ? "Close navigation" : "Expand navigation", exact: true })).toHaveAttribute("aria-expanded", String(open));
  }

  // A native appearance visit must not replace the browser's labeled layout.
  await page.evaluate(() => { delete document.documentElement.dataset.tauriTitlebar; });
  await page.setViewportSize({ width: 1440, height: 900 });
  // The independent browser group keeps its own initially closed policy.
  await expect(page.getByRole("button", { name: "Expand navigation", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(188);
  await expect(primary.locator(".sidebar-folder-label").filter({ hasText: /^Home$/ })).toHaveCSS("position", "static");
});

test("long native context labels stay clear of search after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.dataset.tauriTitlebar = "";
      document.documentElement.dataset.trafficLights = "visible";
    });
  });
  await setup(page);
  const longName = "A deliberately long project name for the narrow desktop window";
  await page.route("**/api/projects", async (route) => {
    const now = new Date().toISOString();
    await route.fulfill({ json: { ok: true, projects: [{ id: "alpha", name: longName, root: "/context/alpha", access: "write", createdAt: now, updatedAt: now }] } });
  });
  await page.reload();
  await page.waitForFunction(() => {
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
    return document.querySelector(".chat-surface") !== null;
  });
  await expect(page.locator(".chat-surface")).toBeVisible();
  const project = page.locator(".workspace-titlebar-context").getByRole("button", { name: /^Switch project:/ });
  await project.click();
  // Filtering removes the intentional Recent/All projects duplicates.
  await page.getByRole("textbox", { name: "Filter projects", exact: true }).fill(longName);
  await page.locator(".cave-project-picker__row").filter({ hasText: longName }).locator(".ui-popover-item").click();
  await expect(project).toHaveAccessibleName(`Switch project: ${longName}, Full access`);
  const context = await page.locator(".workspace-titlebar-context").boundingBox();
  const search = await page.locator(".shell-top .menu-bar__search").boundingBox();
  expect(context!.x + context!.width).toBeLessThanOrEqual(search!.x);
  await expect(page.locator(".shell-top")).toHaveJSProperty("scrollWidth", await page.locator(".shell-top").evaluate((node) => node.clientWidth));
  await page.screenshot({ path: test.info().outputPath("reference-long-context.png") });
});

test("open native rail survives a fullscreen-sized window restoration", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 820 });
  await setup(page);
  await page.evaluate(() => { document.documentElement.dataset.tauriTitlebar = ""; });
  const nav = page.locator(".shell-nav-panel");
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(48);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(48);
  await page.setViewportSize({ width: 1320, height: 820 });
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(48);
  await expect(page.getByRole("button", { name: "Close navigation", exact: true })).toHaveAttribute("aria-expanded", "true");
});
