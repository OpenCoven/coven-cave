import { chromium } from "@playwright/test";

const PORT = process.env.PORT || "3417";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cave:onboarding:dismissed", "1");
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`http://127.0.0.1:${PORT}/?demo=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } })));
await page.waitForTimeout(2000);
await page.screenshot({ path: "./__shots/cave-before.png" });

// Reproduce openPreviewBeside: it calls addSplitTarget(browser, "right"),
// which is exactly what a drag-to-split drop on the right half does.
await page.evaluate(() => {
  window.dispatchEvent(
    new CustomEvent("cave:page-drag-start", { detail: { mode: "browser", label: "Browser" } }),
  );
});
await page.waitForTimeout(600);
const zone = page.locator(".split-dropzone__half--right");
console.log("dropzone count:", await zone.count());
await page.evaluate(() => {
  const el = document.querySelector(".split-dropzone__half--right");
  if (!el) throw new Error("no right dropzone");
  const dt = new DataTransfer();
  dt.setData("application/x-cave-page", "browser");
  el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await page.waitForTimeout(3000);
await page.screenshot({ path: "./__shots/cave-split.png" });

const metrics = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const panels = [...document.querySelectorAll("[data-tile-id]")].map((el) => {
    const b = el.getBoundingClientRect();
    return { id: el.getAttribute("data-tile-id"), x: Math.round(b.x), w: Math.round(b.width) };
  });
  return {
    group: r(".split-host__group") || r("[data-panel-group]"),
    panels,
    browserPane: r(".browser-pane") || r("[data-native-browser-viewport]"),
    iframe: r("iframe[title='Browser']"),
    innerWidth: window.innerWidth,
  };
});
console.log(JSON.stringify(metrics, null, 2));
await b.close();
