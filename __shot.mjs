import { chromium } from "@playwright/test";
const PORT = 3603;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cave:onboarding:dismissed", "1");
  localStorage.setItem("cave:active-familiar", "echo");
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE ERR:", String(e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}/?mode=chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
// Familiar Studio → Projects tab lives behind the Skills/Familiar surface.
await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "roles" } })),
);
await page.waitForTimeout(2500);
const found = await page.evaluate(() => ({
  changes: document.body.innerText.includes("Recent access changes"),
  heading: document.body.innerText.slice(0, 300),
}));
console.log("has block:", found.changes);
await page.screenshot({ path: "/tmp/console-1.png", fullPage: false });
await b.close();
