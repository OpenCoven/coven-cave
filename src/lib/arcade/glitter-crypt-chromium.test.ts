// @ts-nocheck
// Runs the arcade for real in headless Chromium. The pure test next door can
// only prove the document is well-formed; this proves the game LOOP executes —
// which is the whole claim being made about it. Skips cleanly when the
// Playwright browser is not installed, matching canvas-inspector-chromium.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

import { buildArcadeSrcDoc } from "./glitter-crypt.ts";

const executablePath = chromium.executablePath();
if (!existsSync(executablePath)) {
  console.log(`glitter-crypt-chromium.test.ts skipped: browser not installed at ${executablePath}`);
} else {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });

    const failures = [];
    page.on("pageerror", (error) => failures.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(message.text());
    });

    await page.setContent(buildArcadeSrcDoc(), { waitUntil: "load" });

    // ── Boot ────────────────────────────────────────────────────────────────
    assert.equal(
      await page.locator("#veil-title").textContent(),
      "GLITTER CRYPT",
      "opens on the title veil rather than dropping the player in cold",
    );
    assert.equal(await page.locator("#wave").textContent(), "1", "starts on wave 1");
    assert.equal(await page.locator("#score").textContent(), "0", "starts with nothing hexed");
    assert.equal(
      await page.locator("#hearts").textContent(),
      "\u2665\u2665\u2665\u2665\u2665",
      "starts on five full hearts",
    );

    const size = await page.evaluate(() => {
      const canvas = document.getElementById("view");
      return { w: canvas.width, h: canvas.height };
    });
    assert.ok(size.w >= 120 && size.w <= 480, `internal width is capped for cost (got ${size.w})`);
    assert.ok(size.h > 0, "the canvas has height");

    // The first frame must already have painted walls — if the raycaster threw,
    // the canvas would be a single flat color.
    const distinctColors = () => page.evaluate(() => {
      const canvas = document.getElementById("view");
      const ctx = canvas.getContext("2d");
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) {
        seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      }
      return seen.size;
    });
    assert.ok(await distinctColors() > 4, "the first frame renders a shaded scene, not a flat fill");

    // ── The veil's button starts the game ───────────────────────────────────
    await page.locator("#veil-action").click();
    assert.ok(await page.locator("#veil").isHidden(), "entering the crypt dismisses the veil");

    const framebuffer = () => page.evaluate(() => {
      const canvas = document.getElementById("view");
      const ctx = canvas.getContext("2d");
      return Array.from(ctx.getImageData(0, 0, canvas.width, 1).data).join(",");
    });

    // ── Movement actually moves ─────────────────────────────────────────────
    const before = await framebuffer();
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(450);
    await page.keyboard.up("ArrowUp");
    assert.notEqual(await framebuffer(), before, "holding forward changes the view");

    // ── Turning actually turns ──────────────────────────────────────────────
    const beforeTurn = await framebuffer();
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(450);
    await page.keyboard.up("ArrowRight");
    assert.notEqual(await framebuffer(), beforeTurn, "holding turn changes the view");

    // ── Pause ───────────────────────────────────────────────────────────────
    await page.keyboard.press("Escape");
    assert.ok(await page.locator("#veil").isVisible(), "Escape pauses to the veil");
    assert.equal(await page.locator("#veil-title").textContent(), "PAUSED");
    // Pausing must actually stop the simulation, not just draw over it.
    await page.locator("#veil-action").click();
    assert.ok(await page.locator("#veil").isHidden(), "Resume returns to play");

    // ── Firing hexes a wisp ─────────────────────────────────────────────────
    // Aim deliberately rather than sweeping blind: read the bearing to the
    // nearest wisp, turn onto it, then fire. A blind sweep at 2.5 rad/s steps
    // clean over the aim window between shots, which says nothing about
    // whether firing works.
    const snapshot = () => page.evaluate(() => window.__ARCADE_SNAPSHOT__());

    const opening = await snapshot();
    assert.equal(opening.state, "playing", "the sim is running");
    assert.ok(opening.alive > 0, "wave 1 spawned wisps");

    // Budget by wall clock, not by attempt count. Under a loaded CI box the
    // page gets fewer animation frames per real second, so a fixed number of
    // iterations buys an unpredictable amount of simulated time — which is
    // exactly the flake this loop kept producing.
    let hexed = 0;
    let aimedShots = 0;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && hexed === 0) {
      const now = await snapshot();
      hexed = now.score;
      if (hexed > 0) break;
      if (now.state !== "playing") {
        // Dying is a legitimate outcome of standing still. Re-enter and keep
        // going; the assertion below is about firing, not about surviving.
        await page.locator("#veil-action").click();
        await page.waitForTimeout(120);
        continue;
      }
      if (Math.abs(now.bearing) > 0.06) {
        // TURN_SPEED is 2.5 rad/s; hold just long enough to close the gap.
        const hold = Math.min(260, Math.max(16, (Math.abs(now.bearing) / 2.5) * 1000));
        const key = now.bearing > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(key);
        await page.waitForTimeout(hold);
        await page.keyboard.up(key);
        continue;
      }
      // Aimed. A shot can still be eaten by a wall between us, so give the
      // wisp time to close rather than spinning on a blocked line of sight.
      await page.keyboard.press("Space");
      aimedShots += 1;
      await page.waitForTimeout(aimedShots > 8 ? 220 : 70);
    }
    assert.ok(hexed > 0, "aiming at a wisp and zapping it raises the hexed count");

    const afterKill = await snapshot();
    assert.ok(afterKill.alive < opening.alive, "the hexed wisp is gone from the wave");

    // The latch: a tap that starts and ends between two frames must still fire.
    // Proved by the muzzle flash, which only fire() sets.
    const tapFired = await page.evaluate(async () => {
      const canvas = document.getElementById("view");
      const ctx = canvas.getContext("2d");
      const sample = () => {
        const x = Math.round(canvas.width / 2);
        const y = Math.round(canvas.height / 2);
        return Array.from(ctx.getImageData(x - 12, y - 12, 24, 24).data).join(",");
      };
      // Clear any cooldown left over from the aiming loop above.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const before = sample();
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return before !== sample();
    });
    assert.ok(tapFired, "a tap shorter than one frame still fires");

    assert.deepEqual(failures, [], "the game runs without a single page error");
  } finally {
    await browser.close();
  }
}
