import { expect, test, type Request } from "@playwright/test";

test("open sidebar places Dashboard directly above Settings", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "1");
  });

  await page.goto("/?demo=1");

  const footer = page.locator(".shell-nav .sidebar-foot");
  const dashboard = footer.getByRole("link", { name: "Dashboard" });
  const settings = footer.getByRole("button", { name: "Settings", exact: true });

  await expect(footer).toBeVisible();
  await expect(dashboard).toBeVisible();
  await expect(settings).toBeVisible();

  const dashboardBox = await dashboard.boundingBox();
  const settingsBox = await settings.boundingBox();
  expect(dashboardBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(dashboardBox!.y).toBeLessThan(settingsBox!.y);
});

test("Dashboard uses client navigation from Home and Chat without reloading the document", async ({ page }) => {
  test.setTimeout(180_000);

  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "1");
    (window as Window & { __caveDocumentMarker?: string }).__caveDocumentMarker = crypto.randomUUID();
  });

  for (const startPath of ["/?demo=1", "/?mode=chat&demo=1"]) {
    await page.goto(startPath, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 60_000 });
    const dashboard = page.locator(".sidebar-foot").getByRole("link", { name: "Dashboard", exact: true });
    await expect(dashboard).toBeVisible({ timeout: 60_000 });

    const marker = await page.evaluate(() => (window as Window & { __caveDocumentMarker?: string }).__caveDocumentMarker);
    const documentRequests: string[] = [];
    const onRequest = (request: Request) => {
      if (request.resourceType() === "document") documentRequests.push(request.url());
    };
    page.on("request", onRequest);

    try {
      await dashboard.click();
      await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 120_000 });
      await expect(page.locator(".dr-page")).toBeVisible({ timeout: 60_000 });

      expect(documentRequests).toEqual([]);
      expect(
        await page.evaluate(() => (window as Window & { __caveDocumentMarker?: string }).__caveDocumentMarker),
      ).toBe(marker);
    } finally {
      page.off("request", onRequest);
    }
  }
});
