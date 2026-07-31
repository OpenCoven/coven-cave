import { chromium } from "@playwright/test";
const PORT = 3603;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cave:onboarding:dismissed", "1");
  localStorage.setItem("cave:active-familiar", "echo");
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE ERR:", String(e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}/?mode=chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

// Settings hosts the Familiar Studio panel.
await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "settings" } })),
);
await page.waitForTimeout(2500);

// Open Familiar Studio, pick Echo, then the Projects tab.
for (const label of [/Familiar/i, /Studio/i]) {
  const el = page.getByRole("button", { name: label }).first();
  if (await el.count().catch(() => 0)) { await el.click().catch(() => {}); await page.waitForTimeout(1200); break; }
}
await page.waitForTimeout(1500);
const echoBtn = page.getByRole("button", { name: /^Echo$/ }).first();
if (await echoBtn.count().catch(() => 0)) { await echoBtn.click().catch(() => {}); await page.waitForTimeout(1500); }
const projTab = page.getByRole("button", { name: /^Projects$/ }).first();
if (await projTab.count().catch(() => 0)) { await projTab.click().catch(() => {}); await page.waitForTimeout(2500); }

const state = await page.evaluate(() => ({
  hasBlock: document.body.innerText.includes("Recent access changes"),
  hasDecisions: document.body.innerText.includes("Recent decisions"),
  crumbs: [...document.querySelectorAll("button")].map(b => b.textContent?.trim()).filter(Boolean).slice(0, 25),
}));
console.log("Recent access changes:", state.hasBlock, "| Recent decisions:", state.hasDecisions);
console.log("buttons:", JSON.stringify(state.crumbs));
await page.screenshot({ path: "/tmp/console-2.png", fullPage: false });
await b.close();
