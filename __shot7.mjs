import { chromium } from "@playwright/test";
const PORT = 3603;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 2 });
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

// Scroll the studio pane to the bottom so late sections mount/paint.
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1500);
const t = await page.evaluate(() => document.body.innerText);
console.log("has 'Recent access changes':", t.includes("Recent access changes"));
console.log("has 'Recent decisions':", t.includes("Recent decisions"));
console.log("--- last 700 chars of pane text ---");
console.log(t.slice(-700));
await page.screenshot({ path: "/tmp/console-7.png", fullPage: false });
await b.close();
