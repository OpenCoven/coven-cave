import { expect, test } from "@playwright/test";

// Half-width fit guard: every workspace mode and standalone page must lay out
// without horizontal overflow when the window is snapped to 50% of a screen —
// 760px (mobile layout band; 50% of a 13" MacBook) and 1280px (desktop layout
// band; 50% of a 2560px display). Elements are allowed past the right edge
// only inside a deliberate horizontal pattern: an overflow-x scroller (kanban
// rail, marketplace category chips) or a marquee track (home digest). Anything
// else extending past the viewport is clipped, unreachable UI — a regression.
//
// Daemon-less like all e2e here: surfaces render their degraded/empty states,
// which still exercises every header, toolbar, and chrome layout. demo=1
// seeds the demo roster/cards where supported.

const MODES = [
  "home", "chat", "agents", "board", "calendar", "inbox", "github", "roles",
  "marketplace", "flow", "submissions", "capabilities", "familiar-work-queue",
  "journal", "grimoire", "groupchat",
];
const PAGES = ["/settings", "/dashboard"];
const WIDTHS = [760, 1280];

test.describe.configure({ mode: "serial" });

async function overflowOffenders(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const bad: string[] = [];
    const seen = new Set<string>();
    document.querySelectorAll("body *").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.right > vw + 6 && rect.width > 24 && rect.left > -vw) {
        // Walk up: content inside a horizontal scroller or a marquee track is
        // reachable by design, not clipped.
        let p: HTMLElement | null = el as HTMLElement;
        while (p && p !== document.body) {
          const cs = getComputedStyle(p);
          if (cs.overflowX === "auto" || cs.overflowX === "scroll") return;
          if (cs.animationName && cs.animationName.includes("marquee")) return;
          p = p.parentElement;
        }
        const e = el as HTMLElement;
        const cls = typeof e.className === "string"
          ? e.className.split(/\s+/).filter((c) => !c.includes("[") && c.length > 2).slice(0, 2).join(".")
          : "";
        const key = `${e.tagName}.${cls}`;
        if (!seen.has(key) && bad.length < 8) {
          seen.add(key);
          bad.push(`${key} right=${Math.round(rect.right)} (viewport ${vw})`);
        }
      }
    });
    return { docOverflowX: doc.scrollWidth - vw, bad };
  });
}

for (const width of WIDTHS) {
  test(`workspace modes fit ${width}px half-width`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });
    for (const mode of MODES) {
      await page.goto(`/?mode=${encodeURIComponent(mode)}&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1500);
      const r = await overflowOffenders(page);
      expect(r.docOverflowX, `mode=${mode} @${width}px: document scrolls horizontally`).toBeLessThanOrEqual(0);
      expect(r.bad, `mode=${mode} @${width}px: clipped elements outside any scroller/marquee`).toEqual([]);
    }
  });

  test(`standalone pages fit ${width}px half-width`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1500);
      const r = await overflowOffenders(page);
      expect(r.docOverflowX, `${path} @${width}px: document scrolls horizontally`).toBeLessThanOrEqual(0);
      expect(r.bad, `${path} @${width}px: clipped elements outside any scroller/marquee`).toEqual([]);
    }
  });
}
