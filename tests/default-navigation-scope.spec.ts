import { expect, test, type Page } from "@playwright/test";

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
