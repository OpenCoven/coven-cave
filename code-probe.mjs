import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.addInitScript(() => { try { localStorage.setItem("cave:onboarding:dismissed","1"); } catch {} });
try { await p.goto("http://127.0.0.1:4555/", { waitUntil:"domcontentloaded", timeout:25000 }); } catch(e){}
await p.waitForTimeout(3500);
for (const k of ["Meta+8","Meta+0"]) { await p.keyboard.press(k).catch(()=>{}); await p.waitForTimeout(1200); if(await p.evaluate(()=>!!document.querySelector('.chat-scope-tabs'))) break; }
await p.waitForTimeout(1200);
// open a conversation: click a session row in the chat list
await p.locator('text=/Task:|Expand Avatar|arXiv paper/').first().click().catch(()=>{});
await p.waitForTimeout(2000);
// collapse comux rails
await p.locator('[aria-label="Hide projects list"]').first().click().catch(()=>{}); await p.waitForTimeout(700);
await p.locator('[aria-label="Hide project details"]').first().click().catch(()=>{}); await p.waitForTimeout(900);
await p.screenshot({ path:"/tmp/code-conv.png" });
const r = await p.evaluate(() => {
  const m=(el)=>{const b=el.getBoundingClientRect();return `top=${b.top.toFixed(0)} h=${b.height.toFixed(0)} left=${b.left.toFixed(0)}`;};
  const scope=document.querySelector('.chat-scope-tabs');
  const pr=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Show projects list');
  const dr=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Show project details');
  return { scopeTabs: scope?m(scope):"NONE", projectsRail: pr?m(pr):"NONE", detailsRail: dr?m(dr):"NONE", convOpen: !!document.querySelector('.cave-linear-turn, [class*="message"]') };
});
console.log(JSON.stringify(r,null,1));
await b.close();
