import { expect, test, type Page } from "@playwright/test";

// Issue #5192 — the Familiar identity picker reported ~800 icons but rendered
// nearly all of them as the same sparkle glyph. The lazy full-catalogue load
// completed, but the "catalogue landed" signal rode a setState whose value the
// render never read, which the React Compiler memoizes away — so the already-
// mounted grid never re-rendered. This spec drives the real picker (React
// Compiler runs in dev too) and fails unless the grid actually shows distinct
// glyphs once the offline catalogue lands.

const NOVA = {
  id: "nova",
  display_name: "Nova",
  role: "Research assistant",
  status: "active",
  harness: "coven",
};

async function installPickerRoutes(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // openFamiliarStudioSettingsTab("identity", "nova") handoff, replayed:
    // lands the fresh chat surface on Familiar → Settings → Identity.
    window.localStorage.setItem("cave:familiar-scope", JSON.stringify(["nova"]));
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem(
      "cave:familiar-settings-target:v1",
      JSON.stringify({ tab: "identity" }),
    );
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/familiars") {
      await route.fulfill({ json: { ok: true, familiars: [NOVA] } });
      return;
    }
    if (url.pathname === "/api/familiars/removed") {
      await route.fulfill({ json: { ok: true, removed: [] } });
      return;
    }
    if (url.pathname.startsWith("/api/familiars/")) {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ status: 503, json: { ok: false, error: "not needed for this spec" } });
  });
}

async function glyphGridStats(page: Page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-glyph-button="true"]')];
    const bodies = new Map<string, number>();
    let withoutSvg = 0;
    for (const button of buttons) {
      const svg = button.querySelector("svg");
      if (!svg) {
        withoutSvg += 1;
        continue;
      }
      const key = svg.innerHTML.replace(/\s+/g, " ").trim();
      bodies.set(key, (bodies.get(key) ?? 0) + 1);
    }
    const counts = [...bodies.values()].sort((a, b) => b - a);
    return {
      buttons: buttons.length,
      distinct: bodies.size,
      withoutSvg,
      mostRepeated: counts[0] ?? 0,
    };
  });
}

test("identity icon picker renders distinct glyphs once the catalog loads", async ({ page }) => {
  test.setTimeout(240_000);
  await installPickerRoutes(page);

  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded", timeout: 120_000 });

  // Wait for hydration before driving the surface.
  await page
    .locator("[role='tablist'][aria-label='Chat sections']")
    .waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(2_000);

  // The app's own "Manage skills" handoff: switches the chat surface to the
  // Familiar scope, whose mount consumes the pending settings target and
  // renders Settings → Identity → the Icon picker.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("cave:chat-open-skills"));
  });

  const panel = page.locator(".familiar-glyph-picker-panel").first();
  await panel.waitFor({ state: "visible", timeout: 120_000 });
  await page
    .locator('[data-glyph-button="true"]')
    .first()
    .waitFor({ state: "visible", timeout: 120_000 });

  // The lazy offline catalogue lands shortly after first paint. Poll until the
  // grid settles (distinct count stops climbing) so this measures the steady
  // state rather than the pre-load flash.
  let stats = await glyphGridStats(page);
  for (let attempt = 0; attempt < 30 && stats.distinct < stats.buttons; attempt += 1) {
    await page.waitForTimeout(1_000);
    const next = await glyphGridStats(page);
    if (next.distinct === stats.distinct && next.distinct > 1) break;
    stats = next;
  }

  // The picker offers one entry per Phosphor base name; the seeded catalog is
  // ~1530 entries and the panel renders the first 800. A healthy grid shows a
  // distinct glyph per entry — the regression rendered 788 of 800 as the same
  // sparkle fallback.
  expect(stats.buttons).toBeGreaterThan(700);
  expect(stats.distinct).toBeGreaterThan(700);
  // A single body may legitimately repeat a handful of times only.
  expect(stats.mostRepeated).toBeLessThan(10);
  expect(stats.withoutSvg).toBe(0);
});
