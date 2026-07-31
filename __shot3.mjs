import { chromium } from "@playwright/test";
const PORT = 3603;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1150 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cave:onboarding:dismissed", "1");
  localStorage.setItem("cave:active-familiar", "echo");
});
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/?mode=chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

await page.getByRole("button", { name: "Settings", exact: true }).first().click();
await page.waitForTimeout(3000);

const dump = async (tag) => {
  const s = await page.evaluate(() => ({
    block: document.body.innerText.includes("Recent access changes"),
    btns: [...document.querySelectorAll("button")].map(b=>b.textContent?.trim()).filter(Boolean).slice(0,40),
  }));
  console.log(tag, "block:", s.block);
  console.log(tag, "btns:", JSON.stringify(s.btns));
  return s;
};
await dump("after-settings");

// Look for the Familiar Studio entry point by several plausible names.
for (const name of [/Familiar Studio/i, /^Familiars$/i, /^Familiar$/i, /Studio/i]) {
  const el = page.getByRole("button", { name }).first();
  if (await el.count().catch(()=>0)) {
    await el.click().catch(()=>{});
    await page.waitForTimeout(2500);
    break;
  }
}
await dump("after-studio");
await page.screenshot({ path: "/tmp/console-3.png", fullPage: false });
await b.close();
