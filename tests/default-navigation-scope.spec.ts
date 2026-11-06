import { expect, test, type Page } from "@playwright/test";
import { setup } from "./chat-context-fixture";

// The smaller default navigation (#6398), daemon-less. A fresh profile sees
// less; an existing profile keeps its links, data and a truthful destination.

async function prepare(page: Page, preferences?: Record<string, unknown>) {
  await page.route("**/api/marketplace", (route) => route.fulfill({ json: { ok: true, plugins: [] } }));
  await page.route("**/api/skills/directory**", (route) => route.fulfill({ json: { ok: true, entries: [] } }));
  await page.addInitScript((values) => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    if (values) {
      window.localStorage.setItem("cave:surface-preferences:v1", JSON.stringify({ version: 1, values }));
    }
  }, preferences);
}

test("a fresh profile has no Marketplace or Submissions sidebar row", async ({ page }) => {
  const feedRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/home-tweets")) feedRequests.push(request.url());
  });
  await prepare(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click({ timeout: 30_000 });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("button", { name: /^Chat/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByRole("button", { name: /^Memories/ }).first()).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Marketplace/ })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: /^Submissions/ })).toHaveCount(0);
  expect(feedRequests).toEqual([]);
});

test("a saved Marketplace link still opens the installed-items surface", async ({ page }) => {
  await prepare(page);
  await page.goto("/?mode=marketplace");
  await expect(page.getByRole("heading", { name: "Marketplace" }).first()).toBeVisible({ timeout: 30_000 });
});

test("Settings reaches installed capabilities by keyboard", async ({ page }) => {
  await prepare(page);
  await page.goto("/settings#general");
  const entry = page.getByRole("link", { name: "Manage installed items" });
  await entry.scrollIntoViewIfNeeded({ timeout: 30_000 });
  await entry.focus();
  await expect(entry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\?mode=marketplace/);
  await expect(page.getByRole("heading", { name: "Marketplace" }).first()).toBeVisible({ timeout: 30_000 });
});

test("the Settings entry fits a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await prepare(page);
  await page.goto("/settings#general");
  const entry = page.getByRole("link", { name: "Manage installed items" });
  await entry.scrollIntoViewIfNeeded({ timeout: 30_000 });
  const box = await entry.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});

for (const width of [1280, 390]) {
  test(`the Settings entry renders in light mode at ${width}px`, async ({ page }, testInfo) => {
    // A fresh page per width, so the desktop shell state cannot carry into the narrow load.
    await page.setViewportSize({ width, height: 800 });
    await prepare(page);
    // Select light the way a profile does, through the stored mode. Parallel workers
    // share the server preferences store, so keep this page on its local snapshot:
    // with the store unavailable, the client neither reads nor writes it.
    await page.route("**/api/preferences", (route) => route.fulfill({ status: 503, json: { ok: false } }));
    await page.addInitScript(() => window.localStorage.setItem("coven-mode", "light"));
    await page.goto("/settings#general");
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    const entry = page.getByRole("link", { name: "Manage installed items" });
    await entry.scrollIntoViewIfNeeded({ timeout: 30_000 });
    const box = await entry.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`installed-capabilities-light-${width}.png`) });
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  });
}

test("a saved Feed tab opens Memory and keeps the stored choice for rollback", async ({ page }) => {
  await page.addInitScript(() => {
    // Seed once, so a later reload in this test would read what the app wrote.
    if (window.sessionStorage.getItem("seeded")) return;
    window.sessionStorage.setItem("seeded", "1");
    window.localStorage.setItem("cave:surface-preferences:v1", JSON.stringify({ version: 1, values: {
      "familiars.selectedId": "cody", "familiars.viewMode": "detail", "familiars.detailTab": "feed",
    } }));
  });
  // Re-send the mode event until the familiar detail mounts; a single event can
  // land before the workspace listener after a fresh load or reload.
  const openFamiliars = () => page.waitForFunction(() => {
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "agents" } }));
    return document.querySelector('[role="tablist"][aria-label="Familiar details"]') !== null;
  }, undefined, { timeout: 30_000 });
  await setup(page);
  await openFamiliars();
  const tabs = page.getByRole("tablist", { name: "Familiar details" });
  await expect(tabs.getByRole("tab", { name: "Memory" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  await expect(tabs.getByRole("tab", { name: /Feed/ })).toHaveCount(0);
  await expect(page.locator("#familiar-detail-panel-memory")).toBeVisible();
  const stored = () => page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("cave:surface-preferences:v1") ?? "{}").values?.["familiars.detailTab"]);
  // Showing Memory must not rewrite the hidden choice, so a revert finds Feed.
  expect(await stored()).toBe("feed");
  await page.reload();
  await openFamiliars();
  await expect(tabs.getByRole("tab", { name: "Memory" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  expect(await stored()).toBe("feed");
  // An explicit choice replaces it.
  await tabs.getByRole("tab", { name: "Sessions" }).click();
  await expect.poll(stored).toBe("sessions");
});
