import { expect, test, type Page } from "@playwright/test";

function plugin(
  id: string,
  displayName: string,
  logo?: {
    kind: "brand";
    title: string;
    monogram: string;
    assetPath: string;
  },
) {
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
    logo,
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
        plugin("gmail", "Gmail"),
        plugin("broken-brand", "Broken Brand", {
          kind: "brand",
          title: "Broken Brand",
          monogram: "BB",
          assetPath: "/marketplace-logos/missing-brand.png",
        }),
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
  await expect(githubLogo.locator('img[src="/marketplace-logos/github.png"]')).toBeVisible();

  const gmailLogoImage = page.locator(
    '[data-marketplace-logo-id="gmail"][data-marketplace-logo-kind="brand"] img',
  ).first();
  await expect(gmailLogoImage).toBeVisible();
  const hasColoredPixel = await gmailLogoImage.evaluate(async (element) => {
    const image = element as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const [red, green, blue, alpha] = pixels.slice(offset, offset + 4);
      if (alpha > 0 && Math.max(red, green, blue) - Math.min(red, green, blue) > 20) {
        return true;
      }
    }
    return false;
  });
  expect(hasColoredPixel).toBe(true);

  const fallbackLogo = page.locator(
    '[data-marketplace-logo-id="custom-local-tool"][data-marketplace-logo-kind="monogram"]',
  ).first();
  await expect(fallbackLogo).toBeVisible();
  await expect(fallbackLogo).toHaveText("CT");

  const failedBrandLogo = page.locator('[data-marketplace-logo-id="broken-brand"]').first();
  await expect(failedBrandLogo).toHaveAttribute("data-marketplace-logo-kind", "monogram");
  await expect(failedBrandLogo).toHaveText("BB");

  for (const theme of [
    { id: "tide", mode: "dark" as const },
    { id: "tide", mode: "light" as const },
    { id: "ember", mode: "dark" as const },
  ]) {
    await setTheme(page, theme.id, theme.mode);
    await expect(githubLogo).toBeVisible();
    await expect(fallbackLogo).toBeVisible();
    const alpha = await githubLogo.evaluate((element) => {
      const color = getComputedStyle(element).color.trim().toLowerCase();
      if (color === "transparent") return 0;
      const channels = color.match(/[\d.]+/g)?.map(Number) ?? [];
      return color.startsWith("rgba") ? channels[3] ?? 1 : 1;
    });
    expect(alpha).toBeGreaterThan(0);
  }

  await page.getByRole("button", { name: /GitHub/ }).first().click();
  const detail = page.getByRole("dialog", { name: "GitHub details" });
  await expect(detail).toBeVisible();
  await expect(
    detail.locator(
      '[data-marketplace-logo-id="github"][data-marketplace-logo-kind="brand"] img[src="/marketplace-logos/github.png"]',
    ),
  ).toBeVisible();
});
