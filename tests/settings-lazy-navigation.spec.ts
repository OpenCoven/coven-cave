import { expect, test } from "@playwright/test";

// The test owns chunk delivery; a PWA worker must not serve it from its cache.
test.use({ serviceWorkers: "block" });

for (const destination of [
  { query: "about version", id: "settings-group-covencave" },
  { query: "reading text", id: "settings-group-reading-text" },
  { query: "daemon status", id: "settings-group-status" },
  { query: "multi host", id: "settings-group-connection" },
  { query: "daemon info", id: "settings-group-info" },
]) {
  test(`Settings search waits for a cold ${destination.query} section and focuses its destination`, async ({ page }) => {
    await page.goto("/settings#general");
    const search = page.getByRole("searchbox", { name: "Search settings" });
    await expect(search).toBeVisible();
    await expect(page.locator(".settings-shell")).not.toContainText("Startup");
    await search.fill("startup");
    await expect(page.getByText("No settings match", { exact: false })).toBeVisible();

    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let pendingChunks = 0;
    await page.route("**/_next/static/chunks/**", async (route) => {
      pendingChunks++;
      await gate;
      await route.continue();
    });
    try {
      await search.fill(destination.query);
      await page.getByRole("list", { name: "Settings search results" }).getByRole("button").click();
      await expect.poll(() => pendingChunks).toBeGreaterThan(0);
      await expect(page.getByRole("status", { name: "Loading settings" })).toBeVisible();
      release();
      await expect(page.locator(`#${destination.id}`)).toBeVisible();
      await expect.poll(() => page.evaluate((id) => Boolean(
        document.activeElement?.closest(`#${id}`),
      ), destination.id)).toBe(true);

      // A new search must override a manual tab change, even for the same group.
      if (destination.query === "reading text") {
        await page.getByRole("tab", { name: "Theme", exact: true }).click();
        await expect(page.locator(`#${destination.id}`)).not.toBeVisible();
      }
      // Repeating the same search must perform a fresh focus jump too.
      await search.fill(destination.query);
      await page.getByRole("list", { name: "Settings search results" }).getByRole("button").click();
      await expect.poll(() => page.evaluate((id) => Boolean(
        document.activeElement?.closest(`#${id}`),
      ), destination.id)).toBe(true);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}


test("Stop phrases search reaches the working Chat settings", async ({ page }) => {
  await page.goto("/settings#general");
  await page.getByRole("searchbox", { name: "Search settings" }).fill("stop phrases");
  await page.getByRole("list", { name: "Settings search results" }).getByRole("button").click();
  await expect(page.locator("#settings-group-chat")).toContainText("Stop phrases");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("#settings-group-chat")))).toBe(true);
});
