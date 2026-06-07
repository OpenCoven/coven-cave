// One-off Playwright capture for the library smoke test. Drives Chromium
// to /, navigates to Library → All, screenshots the timeline with the 6
// entries already POSTed via the API smoke.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "/tmp");

const VIEWPORT = { width: 1440, height: 900 };
const DPR = 2;

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn("[pageerror]", e.message));

  // Intercept onboarding so the setup overlay doesn't block the views.
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
  await page.waitForTimeout(3000);

  // Click into Library mode
  const libraryBtn = page.getByRole("button", { name: "Library", exact: true }).first();
  if (await libraryBtn.count()) {
    await libraryBtn.click();
    await page.waitForTimeout(1500);
  }

  // Library should land on "All" by default per Task 12, but be defensive
  // and click it anyway.
  const allBtn = page.getByRole("button", { name: "All", exact: true }).first();
  if (await allBtn.count()) {
    await allBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  await page.screenshot({
    path: "/tmp/library-all-default.png",
    fullPage: false,
    type: "png",
    animations: "disabled",
  });
  console.log("✓ /tmp/library-all-default.png");

  // Toggle Group: source
  const groupBtn = page.getByRole("button", { name: /^Group: date$/ }).first();
  if (await groupBtn.count()) {
    await groupBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: "/tmp/library-all-grouped.png",
      fullPage: false,
      type: "png",
      animations: "disabled",
    });
    console.log("✓ /tmp/library-all-grouped.png");
  } else {
    console.warn("group toggle button not found");
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
