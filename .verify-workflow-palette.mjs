import { chromium } from "@playwright/test";

const shots = "/tmp/wf-palette";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /workflows/i }).first().click();
await page.waitForSelector(".workflow-palette", { timeout: 15000 });
await page.waitForTimeout(1000);

// top band, wide
await page.screenshot({ path: `${shots}/wide-top.png`, clip: { x: 0, y: 0, width: 1400, height: 140 } });

// narrow: shrink viewport in place, palette should scroll
await page.setViewportSize({ width: 960, height: 800 });
await page.waitForTimeout(600);
const palette = page.locator(".workflow-palette");
const m = await palette.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
console.log("narrow metrics:", JSON.stringify(m));
await page.screenshot({ path: `${shots}/narrow-top.png`, clip: { x: 0, y: 0, width: 960, height: 140 } });
if (m.scrollWidth > m.clientWidth) {
  await palette.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/narrow-top-scrolled.png`, clip: { x: 0, y: 0, width: 960, height: 140 } });
}
await browser.close();
