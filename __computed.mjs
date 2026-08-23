import { chromium } from "@playwright/test";

const PORT = process.env.PORT || "3417";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/?demo=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } })));
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("cave:page-drag-start", { detail: { mode: "browser", label: "Browser" } }));
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const el = document.querySelector(".split-dropzone__half--right");
  const dt = new DataTransfer();
  dt.setData("application/x-cave-page", "browser");
  el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const sec = document.querySelector(".split-host__tile-panel > .split-host__pane");
  const panel = sec?.parentElement;
  const cs = (el) => {
    const s = getComputedStyle(el);
    return {
      display: s.display, width: s.width, flex: `${s.flexGrow} ${s.flexShrink} ${s.flexBasis}`,
      flexDirection: s.flexDirection, alignItems: s.alignItems, minWidth: s.minWidth, maxWidth: s.maxWidth,
      rect: Math.round(el.getBoundingClientRect().width),
    };
  };
  // does the rule exist in the loaded stylesheets?
  let ruleFound = null;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.selectorText && r.selectorText.includes(".split-host__tile-panel") && r.selectorText.includes(".split-host__pane")) {
        ruleFound = { selector: r.selectorText, css: r.style.cssText };
      }
    }
  }
  return {
    matchesSelector: !!sec,
    section: sec ? cs(sec) : null,
    panel: panel ? cs(panel) : null,
    ruleFound,
    browserPane: (() => { const el = document.querySelector(".browser-pane"); return el ? cs(el) : null; })(),
    paneBody: (() => { const el = document.querySelector(".split-host__pane-body"); return el ? cs(el) : null; })(),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
