// Drive a headless Chromium against a running Cave dev server and run the
// Familiar Studio smoke checklist from the PR description for
// feat/familiar-studio (#218).
//
// Run: node scripts/smoke-familiar-studio.mjs
//
// Requires:
//   - pnpm dev already running on :3000, or set COVEN_CAVE_SMOKE_URL
//   - NEXT_PUBLIC_DEMO=true so the rail has seeded familiars
//
// Output: prints PASS/FAIL per checklist step. Screenshots are written to
// /tmp/familiar-studio-smoke/ for forensic inspection.

import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const OUT = "/tmp/familiar-studio-smoke";
const VIEWPORT = { width: 1440, height: 900 };
const BASE_URL = process.env.COVEN_CAVE_SMOKE_URL ?? "http://localhost:3000";

const results = [];
function rec(step, status, detail = "") {
  results.push({ step, status, detail });
  const tag = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "SKIP";
  console.log(`  [${tag}] ${step}${detail ? " — " + detail : ""}`);
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: "dark",
    deviceScaleFactor: 1,
  });

  // Bypass onboarding overlay (same pattern as capture-screenshots.mjs).
  await ctx.route("**/api/onboarding/status", async (route) => {
    await route.fulfill({
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
    });
  });

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push("[pageerror] " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push("[console] " + msg.text());
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3500); // hydrate + initial data

  // Dismiss any onboarding "Open Cave" if it slipped through.
  const openCave = page.getByRole("button", { name: /open cave/i }).first();
  if (await openCave.count()) {
    await openCave.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await shot(page, "01-initial");

  // ─── Step 0: rail renders with at least one familiar ────────────────
  const avatars = page.locator(".familiar-avatar-rail__avatar");
  const avatarCount = await avatars.count();
  if (avatarCount > 0) rec("rail renders avatars", "PASS", `${avatarCount} avatars`);
  else {
    rec("rail renders avatars", "FAIL", "no avatars found — NEXT_PUBLIC_DEMO not set?");
    await browser.close();
    return summarize();
  }

  const firstAvatar = avatars.first();
  const firstItem = page.locator(".familiar-avatar-rail__item").first();

  // ─── Step 1: hover reveals … edit button ────────────────────────────
  await firstItem.hover();
  await page.waitForTimeout(250);
  const editBtn = firstItem.locator(".familiar-avatar-rail__edit");
  const editVisible = await editBtn.isVisible().catch(() => false);
  // The edit button is opacity-revealed; it's always in the DOM but only
  // visually shown on hover. Check computed opacity instead of isVisible.
  const editOpacity = await editBtn.evaluate((el) => getComputedStyle(el).opacity).catch(() => "0");
  if (parseFloat(editOpacity) > 0.5) rec("hover reveals edit affordance", "PASS", `opacity=${editOpacity}`);
  else rec("hover reveals edit affordance", "FAIL", `opacity=${editOpacity} (expected ~1)`);
  await shot(page, "02-hover-edit");

  // ─── Step 2: clicking edit opens drawer to Identity ─────────────────
  await editBtn.click();
  await page.waitForTimeout(400);
  const drawer = page.locator(".familiar-studio__drawer");
  if (await drawer.isVisible()) rec("edit click opens Studio drawer", "PASS");
  else rec("edit click opens Studio drawer", "FAIL");
  await shot(page, "03-drawer-identity");

  // Identity tab should be active.
  const activeTab = page.locator(".familiar-studio__tab--active span");
  const activeTabText = (await activeTab.first().textContent() || "").trim();
  if (/identity/i.test(activeTabText)) rec("drawer opens to Identity tab", "PASS");
  else rec("drawer opens to Identity tab", "FAIL", `active tab: ${activeTabText}`);

  // ─── Step 3: Identity name change updates rail live ─────────────────
  const nameInput = page.locator(".familiar-studio-identity__input").first();
  const originalNameAttr = await firstAvatar.getAttribute("aria-label");
  const newName = "SmokeBot-Q";
  await nameInput.fill(newName);
  await nameInput.blur();
  await page.waitForTimeout(400);
  const newNameAttr = await firstAvatar.getAttribute("aria-label");
  if (newNameAttr && newNameAttr.includes(newName))
    rec("Identity name updates rail live", "PASS", `aria-label includes "${newName}"`);
  else rec("Identity name updates rail live", "FAIL", `aria-label="${newNameAttr}" (was "${originalNameAttr}")`);
  await shot(page, "04-name-updated");

  // Reset for next steps.
  await page.locator(".familiar-studio-identity__reset").first().click();
  await page.waitForTimeout(300);

  // ─── Step 4: Look tab — switch and check glyph picker renders ───────
  const lookTab = page.locator(".familiar-studio__tab").filter({ hasText: /look/i });
  await lookTab.click();
  await page.waitForTimeout(300);
  const pickerPanel = page.locator(".familiar-glyph-picker-panel, [class*='glyph-picker']");
  const panelCount = await pickerPanel.count();
  if (panelCount > 0) rec("Look tab renders glyph picker panel", "PASS", `${panelCount} matches`);
  else rec("Look tab renders glyph picker panel", "FAIL");
  await shot(page, "05-look-tab");

  // ─── Step 5: color preset tints accent ──────────────────────────────
  const swatches = page.locator(".familiar-studio-look__swatch");
  const swatchCount = await swatches.count();
  if (swatchCount === 8) rec("Look tab has 8 color preset swatches", "PASS");
  else rec("Look tab has 8 color preset swatches", "FAIL", `found ${swatchCount}`);

  await swatches.nth(2).click(); // blue preset
  await page.waitForTimeout(300);
  const accentAfter = await firstAvatar.evaluate((el) =>
    el.style.getPropertyValue("--familiar-accent"),
  );
  if (accentAfter && accentAfter !== "var(--accent-presence)" && accentAfter.length > 0)
    rec("Color preset writes --familiar-accent on rail", "PASS", `accent="${accentAfter}"`);
  else rec("Color preset writes --familiar-accent on rail", "FAIL", `accent="${accentAfter}"`);
  await shot(page, "06-color-applied");

  // Reset color
  await page.locator(".familiar-studio-look__reset").click();
  await page.waitForTimeout(300);

  // ─── Step 6: Brain tab renders harness/model/note ───────────────────
  const brainTab = page.locator(".familiar-studio__tab").filter({ hasText: /brain/i });
  await brainTab.click();
  await page.waitForTimeout(400);
  const harnessSelect = page.locator(".familiar-studio-brain__input").first();
  const harnessIsSelect = await harnessSelect.evaluate((el) => el.tagName === "SELECT").catch(() => false);
  if (harnessIsSelect) rec("Brain tab renders harness select", "PASS");
  else rec("Brain tab renders harness select", "FAIL");

  const modelInput = page.locator('.familiar-studio-brain__input[type="text"]');
  if (await modelInput.count() > 0) rec("Brain tab renders model input", "PASS");
  else rec("Brain tab renders model input", "FAIL");

  const noteArea = page.locator(".familiar-studio-brain__input").nth(2);
  const noteIsTextarea = await noteArea.evaluate((el) => el.tagName === "TEXTAREA").catch(() => false);
  if (noteIsTextarea) rec("Brain tab renders note textarea", "PASS");
  else rec("Brain tab renders note textarea", "FAIL");
  await shot(page, "07-brain-tab");

  // ─── Step 7: Lifecycle tab renders Archive + Reset sections ─────────
  const lifecycleTab = page.locator(".familiar-studio__tab").filter({ hasText: /lifecycle/i });
  await lifecycleTab.click();
  await page.waitForTimeout(300);
  const lifecycleBtns = page.locator(".familiar-studio-lifecycle__btn");
  const lifecycleCount = await lifecycleBtns.count();
  if (lifecycleCount >= 2) rec("Lifecycle tab renders Archive + Reset buttons", "PASS", `${lifecycleCount} buttons`);
  else rec("Lifecycle tab renders Archive + Reset buttons", "FAIL", `${lifecycleCount} buttons`);
  await shot(page, "08-lifecycle-tab");

  // ─── Step 8: Reset all overrides is two-click confirm ───────────────
  const resetBtn = page.locator(".familiar-studio-lifecycle__btn--danger");
  const resetTextBefore = (await resetBtn.textContent() || "").trim();
  await resetBtn.click();
  await page.waitForTimeout(200);
  const resetTextAfter = (await resetBtn.textContent() || "").trim();
  if (/confirm/i.test(resetTextAfter)) {
    rec("Reset button enters confirm state on first click", "PASS", `"${resetTextBefore}" → "${resetTextAfter}"`);
    // Don't actually confirm — just verify the state machine.
    await page.keyboard.press("Escape"); // bail out
    await page.waitForTimeout(200);
  } else {
    rec("Reset button enters confirm state on first click", "FAIL", `text=${resetTextAfter}`);
  }
  await shot(page, "09-reset-confirm-state");

  // Reopen drawer for archive test
  await firstItem.hover();
  await page.waitForTimeout(200);
  await editBtn.click();
  await page.waitForTimeout(300);
  await lifecycleTab.click();
  await page.waitForTimeout(300);

  // ─── Step 9: Archive hides familiar from rail ───────────────────────
  const archiveBtn = page.locator(".familiar-studio-lifecycle__btn").filter({ hasText: /^\s*archive\s*$/i }).first();
  const railBefore = await avatars.count();
  if (await archiveBtn.count() > 0) {
    await archiveBtn.click();
    await page.waitForTimeout(400);
    const railAfter = await avatars.count();
    if (railAfter === railBefore - 1) {
      rec("Archive removes familiar from rail", "PASS", `${railBefore} → ${railAfter}`);
    } else {
      rec("Archive removes familiar from rail", "FAIL", `${railBefore} → ${railAfter} (expected -1)`);
    }
    await shot(page, "10-archived");

    // Verify Unarchive button now shows
    const unarchiveBtn = page.locator(".familiar-studio-lifecycle__btn").filter({ hasText: /unarchive/i });
    if (await unarchiveBtn.count() > 0) {
      await unarchiveBtn.click();
      await page.waitForTimeout(400);
      const railRestored = await avatars.count();
      if (railRestored === railBefore) {
        rec("Unarchive restores familiar to rail", "PASS");
      } else {
        rec("Unarchive restores familiar to rail", "FAIL", `count=${railRestored}, expected ${railBefore}`);
      }
    } else {
      rec("Unarchive button appears after archive", "FAIL");
    }
  } else {
    rec("Archive button present", "FAIL");
  }

  // ─── Step 10: Esc closes drawer ─────────────────────────────────────
  if (await drawer.isVisible()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = !(await drawer.isVisible().catch(() => false));
    if (closed) rec("Esc closes drawer", "PASS");
    else rec("Esc closes drawer", "FAIL");
  } else {
    rec("Esc closes drawer (drawer was already closed)", "SKIP");
  }
  await shot(page, "11-after-esc");

  // ─── Step 11: Right-click avatar opens drawer to Identity ───────────
  await firstAvatar.click({ button: "right" });
  await page.waitForTimeout(300);
  if (await drawer.isVisible()) {
    rec("Right-click avatar opens drawer", "PASS");
    const activeTabText2 = (await activeTab.first().textContent() || "").trim();
    if (/identity/i.test(activeTabText2)) rec("Right-click opens to Identity tab", "PASS");
    else rec("Right-click opens to Identity tab", "FAIL", `active=${activeTabText2}`);
  } else {
    rec("Right-click avatar opens drawer", "FAIL");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await shot(page, "12-right-click");

  // ─── Step 12: Right-click + button exposes manage action ────────────
  const addBtn = page.locator(".familiar-avatar-rail__add").first();
  if (await addBtn.count() > 0) {
    await addBtn.click({ button: "right" });
    await page.waitForTimeout(300);
    const addMenu = page.locator(".familiar-avatar-rail__add-menu").first();
    const manageItem = page.locator(".familiar-avatar-rail__add-menu-item").filter({ hasText: /manage familiars/i }).first();
    if (await addMenu.isVisible().catch(() => false) && await manageItem.count() > 0) {
      rec("Right-click + opens actions menu", "PASS");
      await manageItem.click();
      await page.waitForTimeout(300);
    } else {
      rec("Right-click + opens actions menu", "FAIL");
    }
    if (await drawer.isVisible()) {
      const activeTabText3 = (await activeTab.first().textContent() || "").trim();
      if (/lifecycle/i.test(activeTabText3)) rec("Manage familiars opens list view (Lifecycle tab)", "PASS");
      else rec("Manage familiars opens list view (Lifecycle tab)", "FAIL", `active=${activeTabText3}`);
      // Non-lifecycle tabs should be disabled
      const identityDisabled = await page.locator(".familiar-studio__tab").filter({ hasText: /identity/i }).first().isDisabled();
      if (identityDisabled) rec("List view disables non-Lifecycle tabs", "PASS");
      else rec("List view disables non-Lifecycle tabs", "FAIL");
    } else {
      rec("Manage familiars opens list view", "FAIL");
    }
  } else {
    rec("Add (+) button present", "FAIL");
  }
  await shot(page, "13-list-view");

  // Close drawer cleanly.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // ─── Step 13: Settings panel Edit button opens drawer ───────────────
  // Navigate to Settings if we can find a settings entry. This is best-effort
  // since the path depends on the shell IA.
  const settingsLink = page.getByRole("link", { name: /settings/i }).or(page.locator('a[href*="settings"]')).first();
  if (await settingsLink.count() > 0) {
    await settingsLink.click().catch(() => {});
    await page.waitForTimeout(800);
    const editBtnSettings = page.locator(".settings-familiars-panel__edit").first();
    if (await editBtnSettings.count() > 0) {
      await editBtnSettings.click();
      await page.waitForTimeout(300);
      if (await drawer.isVisible()) {
        rec("Settings panel Edit button opens drawer", "PASS");
        await page.keyboard.press("Escape");
      } else {
        rec("Settings panel Edit button opens drawer", "FAIL", "button clicked but no drawer");
      }
    } else {
      rec("Settings panel has Edit button", "SKIP", "couldn't reach settings page or panel not rendered");
    }
  } else {
    rec("Settings link reachable", "SKIP", "no obvious settings link in nav");
  }
  await shot(page, "14-settings-edit");

  // ─── Console error check ────────────────────────────────────────────
  const featureErrors = consoleErrors.filter((e) =>
    /familiar|studio|avatar|resolve|override/i.test(e),
  );
  if (featureErrors.length === 0) rec("No feature-related console errors", "PASS");
  else rec("No feature-related console errors", "FAIL", `${featureErrors.length} errors: ${featureErrors.slice(0, 3).join(" | ")}`);

  await browser.close();
  return summarize();
}

function summarize() {
  console.log("\n──────────── SUMMARY ────────────");
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  console.log(`PASS: ${pass}   FAIL: ${fail}   SKIP: ${skip}   TOTAL: ${results.length}`);
  console.log(`Screenshots written to: ${OUT}/`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`  - ${r.step}: ${r.detail || "(no detail)"}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Smoke driver crashed:", err);
  process.exitCode = 2;
});
