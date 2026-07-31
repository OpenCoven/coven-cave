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
await page.waitForTimeout(3000);
const step = async (t) => {
  const s = await page.evaluate(() => ({
    block: document.body.innerText.includes("Recent access changes"),
    btns: [...document.querySelectorAll("button")].map(b=>b.textContent?.trim()).filter(Boolean).slice(0,45),
  }));
  console.log(t, "block:", s.block, "|", JSON.stringify(s.btns.slice(0, 30)));
  return s;
};
await step("familiars");

// Select Echo
const echo = page.getByRole("button", { name: /Echo/ }).first();
if (await echo.count().catch(()=>0)) { await echo.click().catch(()=>{}); await page.waitForTimeout(2500); }
await step("echo-selected");

// Projects tab inside the studio
const proj = page.getByRole("button", { name: /^Projects$/ }).first();
if (await proj.count().catch(()=>0)) { await proj.click().catch(()=>{}); await page.waitForTimeout(3000); }
const fin = await step("projects-tab");

if (fin.block) {
  await page.getByText("Recent access changes").first().scrollIntoViewIfNeeded().catch(()=>{});
  await page.waitForTimeout(900);
}
await page.screenshot({ path: "/tmp/console-5.png", fullPage: false });
await b.close();
