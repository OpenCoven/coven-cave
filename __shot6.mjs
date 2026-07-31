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
await page.waitForTimeout(2500);
await page.getByText("Memory / Reflection", { exact: true }).first().click().catch(()=>{});
await page.waitForTimeout(2500);

// The studio tab strip: click the element whose exact text is "Projects".
const tab = page.locator('button:has-text("Projects"), [role="tab"]:has-text("Projects")')
  .filter({ hasNotText: "Projects…" });
const n = await tab.count();
console.log("candidate Projects tabs:", n);
for (let i = 0; i < n; i++) {
  await tab.nth(i).click({ timeout: 4000 }).catch(()=>{});
  await page.waitForTimeout(2500);
  const ok = await page.evaluate(() => document.body.innerText.includes("Recent access changes") || document.body.innerText.includes("Project access"));
  if (ok) { console.log("landed via candidate", i); break; }
}
await page.waitForTimeout(2000);
const s = await page.evaluate(() => ({
  changes: document.body.innerText.includes("Recent access changes"),
  decisions: document.body.innerText.includes("Recent decisions"),
  snippet: (document.body.innerText.match(/Recent access changes[\s\S]{0,400}/)||[""])[0],
}));
console.log("changes:", s.changes, "| decisions:", s.decisions);
if (s.snippet) console.log("SNIPPET:\n" + s.snippet);
if (s.changes) { await page.getByText("Recent access changes").first().scrollIntoViewIfNeeded().catch(()=>{}); await page.waitForTimeout(1000); }
await page.screenshot({ path: "/tmp/console-6.png", fullPage: false });
await b.close();
