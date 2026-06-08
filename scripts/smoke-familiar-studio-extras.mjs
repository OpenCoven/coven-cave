// Extra smoke for the three items the first driver couldn't cover:
//   1. Image upload (PNG drop) — uses Playwright's setInputFiles with a real
//      file written to /tmp. Verifies the <img alt> in the drawer header
//      switches to the uploaded data URL, and that localStorage has the entry.
//   2. Drag-to-reorder persistence across reload — dispatches HTML5 DnD
//      events manually (Playwright's `dragTo` is unreliable for HTML5 native),
//      reloads the page, asserts the new order survived in
//      cave:familiar-order:v1.
//   3. Brain-tab harness change writes ~/.coven/cave-config.json — changes
//      the harness select for one familiar, reads back the JSON file via
//      Node fs, asserts the patch landed, then restores the original config.
//
// Run: node scripts/smoke-familiar-studio-extras.mjs
// Pre-flight: caller MUST have backed up ~/.coven/cave-config.json.

import { chromium } from "@playwright/test";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const OUT = "/tmp/familiar-studio-smoke-extras";
const CONFIG_PATH = join(homedir(), ".coven", "cave-config.json");
const BACKUP_PATH = "/tmp/cave-config.backup.json";
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

// 1x1 transparent PNG (real bytes, not a placeholder).
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function main() {
  await mkdir(OUT, { recursive: true });
  const pngPath = join(OUT, "tiny.png");
  await writeFile(pngPath, Buffer.from(TINY_PNG_BASE64, "base64"));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
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

  // Stub /api/harnesses so the Brain-tab select has options to pick.
  // In dev without a daemon-installed harness, the real endpoint returns
  // an empty list and the test can't exercise the PATCH path.
  await ctx.route("**/api/harnesses", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        harnesses: [
          { id: "codex", label: "Codex", installed: true, chatSupported: true, version: "1.0.0" },
          { id: "claude", label: "Claude Code", installed: true, chatSupported: true, version: "2.0.0" },
          { id: "openclaw", label: "OpenClaw", installed: true, chatSupported: false, version: "0.5.0" },
        ],
      }),
    }),
  );

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(3500);

  // Dismiss onboarding if still visible
  const openCave = page.getByRole("button", { name: /open cave/i }).first();
  if (await openCave.count()) {
    await openCave.click().catch(() => {});
    await page.waitForTimeout(400);
  }

  const firstItem = page.locator(".familiar-avatar-rail__item").first();
  const firstAvatar = page.locator(".familiar-avatar-rail__avatar").first();

  // ─── Test 1: Image upload ─────────────────────────────────────────
  console.log("\n── Test 1: Image upload via setInputFiles ──");
  await firstItem.hover();
  await page.waitForTimeout(200);
  await firstItem.locator(".familiar-avatar-rail__edit").click();
  await page.waitForTimeout(400);

  // Switch to Look tab
  await page.locator(".familiar-studio__tab").filter({ hasText: /look/i }).click();
  await page.waitForTimeout(300);

  // The hidden file input lives inside the upload <label>
  const fileInput = page.locator('.familiar-studio-look__upload input[type="file"]');
  await fileInput.setInputFiles(pngPath);
  await page.waitForTimeout(600);

  // The dropzone should now show the <img alt="Current avatar"> + Remove image button
  const dropzoneImg = page.locator('.familiar-studio-look__dropzone img[alt="Current avatar"]');
  if (await dropzoneImg.count() > 0) {
    rec("Image upload — drawer preview renders", "PASS");
  } else {
    rec("Image upload — drawer preview renders", "FAIL", "no <img alt='Current avatar'> in dropzone");
  }

  // Verify localStorage got the entry
  const lsImage = await page.evaluate(() => {
    const raw = localStorage.getItem("cave:familiar-images:v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const firstKey = Object.keys(parsed)[0];
    return firstKey ? { id: firstKey, mime: parsed[firstKey].mime, len: parsed[firstKey].dataUrl.length } : null;
  });
  if (lsImage && lsImage.mime === "image/png" && lsImage.len > 0) {
    rec("Image upload — localStorage entry written", "PASS", `id=${lsImage.id}, mime=${lsImage.mime}, dataUrl ${lsImage.len}b`);
  } else {
    rec("Image upload — localStorage entry written", "FAIL", `ls=${JSON.stringify(lsImage)}`);
  }

  // Verify the rail avatar now renders an <img> instead of an icon (since FamiliarAvatar prefers image)
  const railAvatarHasImg = await firstAvatar.locator("img").count() > 0;
  if (railAvatarHasImg) {
    rec("Image upload — rail switches to <img>", "PASS");
  } else {
    rec("Image upload — rail switches to <img>", "FAIL");
  }
  await shot(page, "01-image-uploaded");

  // Clean up — remove the image
  const removeBtn = page.locator(".familiar-studio-look__remove");
  if (await removeBtn.count() > 0) {
    await removeBtn.click();
    await page.waitForTimeout(300);
  }
  // Close drawer
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ─── Test 2: Drag-to-reorder persistence ──────────────────────────
  console.log("\n── Test 2: Drag-to-reorder + persistence across reload ──");
  // Capture initial order
  const initialIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".familiar-avatar-rail__avatar")).map(
      (el) => el.getAttribute("data-id"),
    );
  });
  console.log("    Initial id order:", initialIds.slice(0, 5).join(", ") + (initialIds.length > 5 ? "..." : ""));

  if (initialIds.length < 2) {
    rec("Drag-to-reorder: enough familiars to test", "SKIP", `${initialIds.length} avatars`);
  } else {
    // Move item[0] to position[2] (between original 1 and 2)
    const sourceId = initialIds[0];
    const targetId = initialIds[2];

    // Dispatch HTML5 DnD manually. Playwright's dragTo doesn't fire dragstart
    // reliably; using direct event dispatch ensures onDragStart/onDrop fire.
    await page.evaluate(({ sourceId, targetId }) => {
      const items = Array.from(document.querySelectorAll(".familiar-avatar-rail__item"));
      const sourceLi = items.find((li) => li.querySelector(`[data-id="${sourceId}"]`));
      const targetLi = items.find((li) => li.querySelector(`[data-id="${targetId}"]`));
      if (!sourceLi || !targetLi) throw new Error("could not find source/target li");

      const dataTransfer = new DataTransfer();
      const dragStartEvent = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer });
      sourceLi.dispatchEvent(dragStartEvent);

      const dragOverEvent = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer });
      targetLi.dispatchEvent(dragOverEvent);

      const dropEvent = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer });
      targetLi.dispatchEvent(dropEvent);

      const dragEndEvent = new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer });
      sourceLi.dispatchEvent(dragEndEvent);
    }, { sourceId, targetId });

    await page.waitForTimeout(400);

    // Check order changed
    const afterDragIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".familiar-avatar-rail__avatar")).map(
        (el) => el.getAttribute("data-id"),
      ),
    );
    console.log("    After-drag order:", afterDragIds.slice(0, 5).join(", "));

    const orderChanged = JSON.stringify(initialIds) !== JSON.stringify(afterDragIds);
    if (orderChanged) {
      rec("Drag-to-reorder — order changes immediately", "PASS", `${sourceId}: pos ${initialIds.indexOf(sourceId)} → ${afterDragIds.indexOf(sourceId)}`);
    } else {
      rec("Drag-to-reorder — order changes immediately", "FAIL", "no change observed");
    }

    // Check localStorage
    const lsOrder = await page.evaluate(() => {
      const raw = localStorage.getItem("cave:familiar-order:v1");
      return raw ? JSON.parse(raw) : null;
    });
    if (Array.isArray(lsOrder) && lsOrder.length > 0) {
      rec("Drag-to-reorder — localStorage written", "PASS", `${lsOrder.length} ids stored`);
    } else {
      rec("Drag-to-reorder — localStorage written", "FAIL", `ls=${JSON.stringify(lsOrder)}`);
    }

    // Reload the page and assert the new order survives
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const afterReloadIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".familiar-avatar-rail__avatar")).map(
        (el) => el.getAttribute("data-id"),
      ),
    );
    console.log("    After-reload order:", afterReloadIds.slice(0, 5).join(", "));

    if (JSON.stringify(afterReloadIds) === JSON.stringify(afterDragIds)) {
      rec("Drag-to-reorder — order persists across reload", "PASS");
    } else {
      rec("Drag-to-reorder — order persists across reload", "FAIL", `expected ${afterDragIds.slice(0, 3)}, got ${afterReloadIds.slice(0, 3)}`);
    }
    await shot(page, "02-after-reload");

    // Cleanup: clear order so subsequent runs don't accumulate state
    await page.evaluate(() => localStorage.removeItem("cave:familiar-order:v1"));
  }

  // ─── Test 3: Brain-tab harness write to cave-config.json ──────────
  console.log("\n── Test 3: Brain-tab harness write to cave-config.json ──");

  // Read current config before the test
  const configBefore = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  // The previous drag-test moved nova to position 2, so the *current* first
  // rail avatar is whoever ended up at position 0 (sage in the demo seed).
  // Read the actual data-id from the DOM at brain-test time.
  const targetFamiliarId = await firstAvatar.getAttribute("data-id");
  const harnessBefore = configBefore.familiars?.[targetFamiliarId]?.harness ?? null;
  console.log(`    Target familiar: ${targetFamiliarId}, harness-before=${harnessBefore ?? "(inherits default)"}`);

  // Open drawer → Brain tab
  await firstItem.hover();
  await page.waitForTimeout(200);
  await firstItem.locator(".familiar-avatar-rail__edit").click();
  await page.waitForTimeout(400);
  await page.locator(".familiar-studio__tab").filter({ hasText: /brain/i }).click();
  await page.waitForTimeout(400);

  // Inspect the harness select's options to find one that isn't current
  const select = page.locator(".familiar-studio-brain__input").first();
  const options = await select.locator("option").allTextContents();
  const optionValues = await select.locator("option").evaluateAll((els) =>
    els.map((el) => el.value),
  );
  console.log("    Harness options:", optionValues.filter((v) => v).join(", "));

  // Pick a value that's different from current
  const newHarness = optionValues.find((v) => v && v !== harnessBefore);
  if (!newHarness) {
    rec("Brain-tab harness PATCH writes cave-config.json", "SKIP", "no alternative harness option available");
  } else {
    await select.selectOption(newHarness);
    await page.waitForTimeout(1200); // give PATCH /api/config time to land

    // Read the JSON file from disk
    const configAfter = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    const harnessAfter = configAfter.familiars?.[targetFamiliarId]?.harness ?? null;
    console.log(`    harness-after=${harnessAfter ?? "(inherits default)"}`);
    if (harnessAfter === newHarness) {
      rec("Brain-tab harness PATCH writes cave-config.json", "PASS", `${harnessBefore ?? "(default)"} → ${newHarness}`);
    } else {
      rec("Brain-tab harness PATCH writes cave-config.json", "FAIL", `expected ${newHarness}, got ${harnessAfter}`);
    }
    await shot(page, "03-brain-harness-saved");
  }

  await page.keyboard.press("Escape");

  // ─── Restore cave-config.json from backup ─────────────────────────
  console.log("\n── Restoring cave-config.json from backup ──");
  try {
    const backup = await readFile(BACKUP_PATH, "utf8");
    await writeFile(CONFIG_PATH, backup, "utf8");
    rec("cave-config.json restored from backup", "PASS");
  } catch (err) {
    rec("cave-config.json restored from backup", "FAIL", String(err));
  }

  // Final console error check
  const featureErrors = consoleErrors.filter((e) => /familiar|studio|avatar|resolve|override/i.test(e));
  if (featureErrors.length === 0) rec("No feature-related console errors", "PASS");
  else rec("No feature-related console errors", "FAIL", `${featureErrors.length} errors`);

  await browser.close();
  summarize();
}

function summarize() {
  console.log("\n──────────── SUMMARY ────────────");
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  console.log(`PASS: ${pass}   FAIL: ${fail}   SKIP: ${skip}   TOTAL: ${results.length}`);
  console.log(`Screenshots: ${OUT}/`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`  - ${r.step}: ${r.detail || "(no detail)"}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Driver crashed:", err);
  process.exitCode = 2;
});
