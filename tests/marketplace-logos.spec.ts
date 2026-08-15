import { expect, test, type Page } from "@playwright/test";

function plugin(id: string, displayName: string) {
  return {
    id,
    displayName,
    description: `${displayName} marketplace listing.`,
    category: "Developer Tools",
    author: "OpenCoven",
    trust: "reference-local",
    policy: { installation: "AVAILABLE", authentication: "NONE" },
    capabilities: ["tools"],
    keywords: [],
    roleAffinity: [],
    kind: "mcp",
    version: "1.0.0",
    installed: true,
    updateAvailable: false,
    requiresSetup: false,
    available: true,
    requiredConfig: [],
    configured: true,
  };
}

async function openMarketplace(page: Page) {
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/marketplace", (route) => route.fulfill({
    json: {
      ok: true,
      plugins: [
        plugin("github", "GitHub"),
        plugin("custom-local-tool", "Custom Local Tool"),
      ],
    },
  }));
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.goto("/?mode=marketplace");
  await expect(page.getByRole("heading", { name: "Marketplace" }).first()).toBeVisible({ timeout: 30_000 });
}

async function setTheme(page: Page, theme: string, mode: "dark" | "light") {
  await page.evaluate(
    ({ theme, mode }) => {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.setAttribute("data-mode", mode);
      window.dispatchEvent(
        new CustomEvent("cave:theme-changed", { detail: { themeId: theme, mode } }),
      );
    },
    { theme, mode },
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
}

test("marketplace cards and details show brand marks with resilient monograms", async ({ page }) => {
  await openMarketplace(page);

  const githubLogo = page.locator(
    '[data-marketplace-logo-id="github"][data-marketplace-logo-kind="brand"]',
  ).first();
  await expect(githubLogo).toBeVisible();
  await expect(githubLogo.locator("svg path")).toHaveCount(1);

  const fallbackLogo = page.locator(
    '[data-marketplace-logo-id="custom-local-tool"][data-marketplace-logo-kind="monogram"]',
  ).first();
  await expect(fallbackLogo).toBeVisible();
  await expect(fallbackLogo).toHaveText("CT");

  for (const theme of [
    { id: "tide", mode: "dark" as const },
    { id: "tide", mode: "light" as const },
    { id: "ember", mode: "dark" as const },
  ]) {
    await setTheme(page, theme.id, theme.mode);
    await expect(githubLogo).toBeVisible();
    await expect(fallbackLogo).toBeVisible();
    const logoColor = await githubLogo.evaluate((element) => getComputedStyle(element).color);
    expect(logoColor).not.toBe("rgba(0, 0, 0, 0)");
  }

  await page.getByRole("button", { name: /GitHub/ }).first().click();
  const detail = page.getByRole("dialog", { name: "GitHub details" });
  await expect(detail).toBeVisible();
  await expect(
    detail.locator('[data-marketplace-logo-id="github"][data-marketplace-logo-kind="brand"] svg path'),
  ).toHaveCount(1);
});
