import { chromium } from "@playwright/test";
const PORT = 3603;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1150 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cave:onboarding:dismissed", "1");
  localStorage.setItem("cave:active-familiar", "echo");
});
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await page.getByRole("button", { name: "Familiars", exact: true }).first().click();
await page.waitForTimeout(2000);
await page.getByText("Memory / Reflection", { exact: true }).first().click().catch(()=>{});
await page.waitForTimeout(2000);
await page.locator('button:has-text("Projects")').filter({ hasNotText: "…" }).first().click().catch(()=>{});
await page.waitForTimeout(3500);

// Expand the full list, then frame the block.
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 1400); await page.waitForTimeout(350); }
await page.getByRole("button", { name: /Show all 11 changes/ }).first().click().catch(()=>{});
await page.waitForTimeout(1200);
const h = page.getByText("Recent access changes").first();
await h.scrollIntoViewIfNeeded().catch(()=>{});
await page.waitForTimeout(800);
await page.mouse.wheel(0, -260);
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/console-final.png", fullPage: false });
await b.close();
