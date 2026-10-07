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
  // The game's own fire window (#5801): fire() hexes a wisp within
  // AIM_TOLERANCE + RANGE_SLACK / dist radians. The controller reads both from
  // the game so the two can't drift, and fires inside three quarters of it.
  // A fixed ±0.06 was stricter than the game and narrower than one capped
  // frame's turn, so under sparse frames a small correction never landed.
  const arcadeSource = buildArcadeSrcDoc();
  const aimTolerance = Number(/var AIM_TOLERANCE = ([\d.]+);/.exec(arcadeSource)?.[1]);
  const rangeSlack = Number(/AIM_TOLERANCE \+ ([\d.]+) \/ Math\.max\(dist, 1\)/.exec(arcadeSource)?.[1]);
  assert.ok(aimTolerance > 0 && rangeSlack > 0, "the game's fire window is readable from its source");
  const fireWindow = (dist) => 0.75 * (aimTolerance + rangeSlack / Math.max(dist, 1));

  // The crypt's floor plan, also read from the game, for the search below.
  const mapRows = [.../var MAP = \[([\s\S]*?)\];/.exec(arcadeSource)?.[1].matchAll(/"([^"]+)"/g) ?? []].map((m) => m[1]);
  assert.ok(mapRows.length > 2 && mapRows.every((row) => row.length === mapRows[0].length), "the crypt map is readable from its source");
  const isFloor = (x, y) => mapRows[y]?.[x] === ".";
  const cellKey = (cell) => `${cell.x},${cell.y}`;
  const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  /** The floor cell holding a point, or the nearest floor neighbour when the
   *  point sits on a wall's edge (a wisp pinned in a corner does). */
  function floorCellAt(point) {
    const base = { x: Math.floor(point.x), y: Math.floor(point.y) };
    const candidates = [base, ...STEPS.map(([dx, dy]) => ({ x: base.x + dx, y: base.y + dy }))]
      .filter((cell) => isFloor(cell.x, cell.y));
    candidates.sort((a, b) =>
      Math.hypot(a.x + 0.5 - point.x, a.y + 0.5 - point.y) - Math.hypot(b.x + 0.5 - point.x, b.y + 0.5 - point.y));
    return candidates[0] ?? null;
  }
  /** The first cell of a shortest four-way floor path between two cells. */
  function nextCellToward(from, to) {
    const previous = new Map([[cellKey(from), null]]);
    const queue = [from];
    while (queue.length > 0) {
      const cell = queue.shift();
      if (cell.x === to.x && cell.y === to.y) {
        let step = cell;
        while (previous.get(cellKey(step)) && cellKey(previous.get(cellKey(step))) !== cellKey(from)) {
          step = previous.get(cellKey(step));
        }
        return step;
      }
      for (const [dx, dy] of STEPS) {
        const next = { x: cell.x + dx, y: cell.y + dy };
        if (!isFloor(next.x, next.y) || previous.has(cellKey(next))) continue;
        previous.set(cellKey(next), cell);
        queue.push(next);
      }
    }
    return null;
  }

  // `seed` fixes wave 1's layout: the delayed-frame regression uses 3, and
  // 123 and 127 pin every wave-1 wisp out of sight from the start (#5801).
  // Unseeded runs keep random normal gameplay.
  async function checkGame(frameDelay, seed = frameDelay ? 3 : null) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 640, height: 400 } });

      const failures = [];
      page.on("pageerror", (error) => failures.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error") failures.push(message.text());
      });

      const seeded = seed != null
        ? `<script>let seed=${seed}; Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};</script>`
        : "";
      await page.setContent(arcadeSource.replace("<head>", "<head>" + seeded), { waitUntil: "load" });

      assert.equal(await page.evaluate(() => document.compatMode), "CSS1Compat", "seeded and normal documents preserve standards mode");

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
      // nearest visible wisp, turn onto it, then fire. A blind sweep at 2.5 rad/s steps
      // clean over the aim window between shots, which says nothing about
      // whether firing works.
      const snapshot = () => page.evaluate(() => window.__ARCADE_SNAPSHOT__(true));

      // Reproduce sparse simulation frames without changing keyboard, collision,
      // or the existing 60-second aiming deadline. The nearer occluded wisp used
      // to consume the entire deadline while a visible target was available.
      if (frameDelay) {
        await page.evaluate((delay) => {
          const native = window.requestAnimationFrame.bind(window);
          window.__nativeRAF = native;
          window.requestAnimationFrame = (callback) => native(() => setTimeout(() => {
            callback(performance.now());
          }, delay));
        }, frameDelay);
      }
      const targeting = await page.evaluate(() => ({
        defaultTarget: window.__ARCADE_SNAPSHOT__(),
        explicitDefault: window.__ARCADE_SNAPSHOT__(false),
        visibleTarget: window.__ARCADE_SNAPSHOT__(true),
      }));
      assert.deepEqual(targeting.defaultTarget, targeting.explicitDefault, "omitted visibility option retains default targeting");
      assert.ok(targeting.defaultTarget.nearest <= targeting.visibleTarget.nearest, "default targeting includes every living wisp");
      assert.equal(targeting.defaultTarget.alive, targeting.visibleTarget.alive, "visibility selection does not alter game state");
      const opening = await snapshot();
      assert.equal(opening.state, "playing", "the sim is running");
      assert.ok(opening.alive > 0, "wave 1 spawned wisps");

      // Budget by wall clock, not by attempt count. Under a loaded CI box the
      // page gets fewer animation frames per real second, so a fixed number of
      // iterations buys an unpredictable amount of simulated time — which is
      // exactly the flake this loop kept producing.
      let hexed = 0;
      let aimedShots = 0;
      let seekSteps = 0;
      let lastSighting = Date.now();
      const turnToward = async (bearing) => {
        // TURN_SPEED is 2.5 rad/s; hold just long enough to close the gap.
        const hold = Math.min(260, Math.max(16, (Math.abs(bearing) / 2.5) * 1000));
        const key = bearing > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(key);
        await page.waitForTimeout(hold);
        await page.keyboard.up(key);
      };
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && hexed === 0) {
        const now = await snapshot();
        hexed = now.score;
        if (hexed > 0) break;
        if (now.state !== "playing") {
          // Dying is a legitimate outcome of standing still or of walking up to
          // a wisp. Re-enter and keep going; the assertion below is about
          // firing, not about surviving.
          await page.locator("#veil-action").click();
          await page.waitForTimeout(120);
          continue;
        }
        if (!now.targetVisible) {
          // Wisps chase in a straight line and stop for good in a concave
          // wall corner, so a player who only waits can wait out the whole
          // deadline with every wisp pinned out of sight (#5801). After a
          // while with nothing in sight, walk toward the nearest wisp, seen
          // or not: moving changes every chase line and frees them. A straight
          // line toward a wisp behind a wall only walks into the wall, so the
          // walk follows the floor plan's shortest path.
          const hidden = Date.now() - lastSighting < 4000
            ? null
            : await page.evaluate(() => window.__ARCADE_SNAPSHOT__(false));
          const heading = hidden ? hidden.angle + hidden.bearing : 0;
          const wisp = hidden && Number.isFinite(hidden.nearest)
            ? { x: hidden.x + Math.cos(heading) * hidden.nearest, y: hidden.y + Math.sin(heading) * hidden.nearest }
            : null;
          const goal = wisp && floorCellAt(wisp);
          const next = goal && nextCellToward({ x: Math.floor(hidden.x), y: Math.floor(hidden.y) }, goal);
          if (!next) {
            await page.waitForTimeout(70);
            continue;
          }
          const waypoint = { x: next.x + 0.5, y: next.y + 0.5 };
          let turn = Math.atan2(waypoint.y - hidden.y, waypoint.x - hidden.x) - hidden.angle;
          while (turn < -Math.PI) turn += Math.PI * 2;
          while (turn > Math.PI) turn -= Math.PI * 2;
          if (Math.abs(turn) > 0.25) {
            await turnToward(turn);
            continue;
          }
          // MOVE_SPEED is 2.9 cells/s; stop near the waypoint, not past it.
          const walk = Math.min(250, Math.max(60, (Math.hypot(waypoint.x - hidden.x, waypoint.y - hidden.y) / 2.9) * 1000));
          await page.keyboard.down("ArrowUp");
          await page.waitForTimeout(walk);
          await page.keyboard.up("ArrowUp");
          seekSteps += 1;
          continue;
        }
        lastSighting = Date.now();
        if (Math.abs(now.bearing) > fireWindow(now.nearest)) {
          await turnToward(now.bearing);
          continue;
        }
        // Aimed at a visible target. It can move between observation and fire;
        // the real fire/collision path still decides whether the shot hits.
        await page.keyboard.press("Space");
        aimedShots += 1;
        await page.waitForTimeout(aimedShots > 8 ? 220 : 70);
      }
      assert.ok(hexed > 0, `aiming at a wisp and zapping it raises the hexed count: ${JSON.stringify({ seed, frameDelay, aimedShots, seekSteps, snapshot: await snapshot() })}`);

      if (frameDelay) {
        await page.evaluate(() => { window.requestAnimationFrame = window.__nativeRAF; });
        // Restoring RAF does not cancel the one delayed callback already queued.
        // Drain it before the independent short-tap assertion below.
        await page.waitForTimeout(frameDelay + 50);
      }
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
  await checkGame(0);
  await checkGame(1500);
  // Every wave-1 wisp pins in a wall corner out of sight (#5801).
  await checkGame(0, 123);
  await checkGame(0, 127);
}
