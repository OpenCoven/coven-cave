// Capture a mobile-viewport screenshot of CovenCave to verify the
// max-width: 767px breakpoint behaves: avatar rail at top, sidebar
// hidden, detail full-width.
//
// Run: node scripts/capture-mobile-screenshot.mjs
// Requires the dev server already running at http://localhost:3000.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "screenshots");
await mkdir(OUT, { recursive: true });

const VIEWPORT = { width: 390, height: 844 }; // iPhone 14 Pro logical
const DPR = 2;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: DPR,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();
page.on("pageerror", (err) => console.warn("[pageerror]", err.message));

// Skip the onboarding overlay (same trick as the desktop capture).
await ctx.route("**/api/onboarding/status", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      complete: true,
      steps: {
        covenCli: { ok: true },
        covenHome: { ok: true },
        adapters: { ok: true },
        daemon: { ok: true },
        familiars: { ok: true },
        binding: { ok: true },
      },
    }),
  }),
);

await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(3500);

await page.screenshot({
  path: resolve(OUT, "mobile-home.png"),
  fullPage: false,
  type: "png",
  animations: "disabled",
});
console.log("OK mobile-home.png");

// Switch to Chat (sidebar is hidden — verify navigation still works via
// the keybind ⌘2). On mobile we can't easily simulate ⌘2, so navigate
// programmatically via window.history pushState — but the surface
// switch is driven by component state, not URL. Skip; the home capture
// is the primary acceptance criterion.

await browser.close();
console.log("done.");
