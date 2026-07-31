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
await page.waitForTimeout(4000);
const s1 = await page.evaluate(() => ({
  url: location.pathname,
  block: document.body.innerText.includes("Recent access changes"),
  btns: [...document.querySelectorAll("button")].map(b=>b.textContent?.trim()).filter(Boolean).slice(0,45),
}));
console.log("url:", s1.url, "| block:", s1.block);
console.log("btns:", JSON.stringify(s1.btns));
await page.screenshot({ path: "/tmp/console-4.png", fullPage: false });
await b.close();
