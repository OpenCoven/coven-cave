#!/usr/bin/env node
/**
 * Event plane request-count gate (#5869, planned in Task 10 of
 * docs/superpowers/plans/2026-08-28-demand-driven-websocket-event-plane.md).
 *
 * A real browser against the BUILT server (`server.mjs` plus `.next`) in a
 * scratch home, with the plane on and the web rollout mode `primary`:
 *
 * 1. Healthy. Once the board's socket topic is ready, a 60-second window
 *    makes no recurring board reads. Without the plane the board polls every
 *    15 seconds, so this window would otherwise hold four.
 * 2. Burst. Three board writes in quick succession reach the open board as
 *    invalidations and cost a bounded number of replacement reads, not one
 *    per write plus polls.
 * 3. Fallback. With the socket refused, the board's 15-second poll is back.
 *
 * Only the board pauses in primary mode: Val kept sessions and daemon polling
 * authoritative on 2026-10-08 (#5858), so their reads are not counted here.
 *
 * Run `pnpm build` first. Takes about two minutes. Set
 * EVENT_PLANE_HEALTHY_WINDOW_MS to shorten the healthy window while iterating.
 *
 *   node scripts/event-plane-request-count.mjs
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { buildCaveEnvironment, freePort, stopCave } from "./client-v1-conformance.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEALTHY_WINDOW_MS = Number(process.env.EVENT_PLANE_HEALTHY_WINDOW_MS) || 60_000;
const BOARD_POLL_MS = 15_000;
const FALLBACK_WINDOW_MS = BOARD_POLL_MS * 2 + 5_000;

async function startCave() {
  const port = await freePort();
  const scratch = mkdtempSync(path.join(tmpdir(), "cave-event-requests-"));
  const env = buildCaveEnvironment({
    port,
    caveHomeDir: path.join(scratch, "cave-home"),
    covenHomeDir: path.join(scratch, "coven-home"),
    adminToken: null,
    mobileAccessToken: null,
  });
  env.COVEN_CAVE_EVENT_PLANE_ENABLED = "1";
  env.COVEN_CAVE_EVENT_WEB_MODE = "primary";
  env.COVEN_CAVE_EVENT_IOS_MODE = "off";
  // Board writes below must land in this run's scratch home, never ~/.coven.
  assert.ok(env.COVEN_CAVE_HOME.startsWith(scratch) && env.COVEN_HOME.startsWith(scratch), "refusing to run outside the scratch home");
  const child = spawn(process.execPath, ["server.mjs"], { cwd: repositoryRoot, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4_000); });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Cave exited before readiness:\n${stderr}`);
    try {
      const res = await fetch(`${origin}/api/events/capability`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) {
        const { eventPlane } = await res.json();
        assert.equal(eventPlane.enabled, true);
        assert.equal(eventPlane.rolloutMode.web, "primary");
        return {
          origin,
          async stop() {
            await stopCave({ child }, port);
            rmSync(scratch, { recursive: true, force: true });
          },
        };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGKILL");
  throw new Error(`Cave readiness timed out:\n${stderr}`);
}

/** Count GET /api/board reads from the page, and see the socket's ready barrier. */
function instrument(page) {
  const started = Date.now();
  const counter = { boardReads: 0, boardReady: false, timeline: [] };
  const note = (entry) => counter.timeline.push(`${((Date.now() - started) / 1_000).toFixed(1)}s ${entry}`);
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/board") {
      counter.boardReads += 1;
      note(`GET ${new URL(request.url()).pathname}${new URL(request.url()).search}`);
    }
  });
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/api/events-ws")) return;
    note("socket open");
    socket.on("close", () => note("socket close"));
    socket.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === "ready" && message.topics?.includes("board")) counter.boardReady = true;
        note(`socket ${message.type}${message.topic ? ` ${message.topic}` : ""}${message.topics ? ` [${message.topics.join(",")}]` : ""}`);
      } catch {
        // Not JSON; the client will refuse it.
      }
    });
  });
  return counter;
}

async function openBoard(context, origin) {
  const page = await context.newPage();
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  const counter = instrument(page);
  await page.goto(`${origin}/?mode=board`, { waitUntil: "domcontentloaded" });
  return { page, counter };
}

async function waitFor(condition, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createCard(origin, title) {
  const res = await fetch(`${origin}/api/board`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ title }),
  });
  assert.equal(res.status, 200, await res.text());
}

const results = [];
function record(name, passed, detail) {
  results.push(passed);
  console.log(`${passed ? "ok" : "not ok"} - ${name} (${detail})`);
}

async function main() {
  const cave = await startCave();
  const browser = await chromium.launch();
  try {
    // 1. Healthy primary window.
    const healthyContext = await browser.newContext();
    const healthy = await openBoard(healthyContext, cave.origin);
    await waitFor(() => healthy.counter.boardReads > 0, "the board's first read");
    await waitFor(() => healthy.counter.boardReady, "the board topic's ready barrier");
    await sleep(3_000); // let the mount, warmup and barrier settle
    const settled = healthy.counter.boardReads;
    await sleep(HEALTHY_WINDOW_MS);
    const recurring = healthy.counter.boardReads - settled;
    if (recurring !== 0) console.log(healthy.counter.timeline.map((line) => `  ${line}`).join("\n"));
    record(
      `a healthy ${HEALTHY_WINDOW_MS / 1_000}-second primary window makes no recurring board reads`,
      recurring === 0,
      `${recurring} recurring read(s); polling alone would make ${Math.floor(HEALTHY_WINDOW_MS / BOARD_POLL_MS)}`,
    );

    // 2. A burst of writes on the same healthy page.
    const beforeBurst = healthy.counter.boardReads;
    await createCard(cave.origin, "request-count burst 1");
    await createCard(cave.origin, "request-count burst 2");
    await createCard(cave.origin, "request-count burst 3");
    await waitFor(() => healthy.counter.boardReads > beforeBurst, "a replacement read after the burst", 10_000).catch(() => {});
    await sleep(2_000);
    const replacements = healthy.counter.boardReads - beforeBurst;
    record(
      "three quick writes cost one to three replacement reads",
      replacements >= 1 && replacements <= 3,
      `${replacements} replacement read(s)`,
    );
    await healthyContext.close();

    // 3. Socket refused: the 15-second fallback returns.
    const fallbackContext = await browser.newContext();
    await fallbackContext.routeWebSocket(/\/api\/events-ws/, (socket) => socket.close({ code: 1011, reason: "refused for the gate" }));
    const fallback = await openBoard(fallbackContext, cave.origin);
    await waitFor(() => fallback.counter.boardReads > 0, "the fallback board's first read");
    await sleep(3_000);
    const fallbackSettled = fallback.counter.boardReads;
    await sleep(FALLBACK_WINDOW_MS);
    const polled = fallback.counter.boardReads - fallbackSettled;
    record(
      "with the socket refused, the board polls again",
      polled >= 2 && !fallback.counter.boardReady,
      `${polled} read(s) in ${FALLBACK_WINDOW_MS / 1_000} s`,
    );
    await fallbackContext.close();
  } finally {
    await browser.close();
    await cave.stop();
  }
  const passed = results.filter(Boolean).length;
  console.log(`event-plane-request-count: ${passed} of ${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
