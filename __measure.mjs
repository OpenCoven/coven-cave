import { chromium } from "@playwright/test";

const PORT = process.env.PORT || "3417";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
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
await page.waitForTimeout(3000);

const dump = await page.evaluate(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const out = {};
  out.group = [...document.querySelectorAll('[data-panel-group], .split-host__group')].map((el) => ({
    cls: el.className, ...box(el),
  }));
  out.panels = [...document.querySelectorAll('[data-panel]')].map((el) => ({
    id: el.id || el.getAttribute("data-panel-id") || el.getAttribute("data-tile-id"),
    cls: typeof el.className === "string" ? el.className.slice(0, 70) : "",
    style: el.getAttribute("style"),
    ...box(el),
  }));
  const bp = document.querySelector(".browser-pane") || document.querySelector("[data-native-browser-viewport]");
  const chain = [];
  let n = bp;
  while (n && n !== document.body) {
    chain.push({ tag: n.tagName, cls: typeof n.className === "string" ? n.className.slice(0, 90) : "", ...box(n) });
    n = n.parentElement;
  }
  out.browserChain = chain;
  return out;
});
console.log(JSON.stringify(dump, null, 2));
await b.close();
