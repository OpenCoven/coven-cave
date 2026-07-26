// @ts-nocheck
// Behavioral test for the server.ts heap monitor (cave-ksjt).
//
// server.ts is transpiled standalone (it cannot import src/), so the monitor
// lives inline. To test its BEHAVIOR — warn watermark, one-snapshot-per-
// episode latch, re-arm on recovery, bounded snapshot retention — this test
// slices the monitor section out of server.ts and evaluates it with injected
// fakes for V8 heap statistics, the snapshot writer, and the timer.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "esbuild";

const src = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

const START = "// ── Heap telemetry (cave-ksjt)";
const END = "\nstartHeapMonitor();";
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END, startIdx);
assert.ok(startIdx !== -1, "server.ts contains the heap telemetry section");
assert.ok(endIdx !== -1, "the telemetry section ends by starting the monitor");
// Strip types the same way build:server does, so the harness evaluates the
// exact logic that ships in server.mjs.
const section = transformSync(src.slice(startIdx, endIdx), { loader: "ts", format: "esm" }).code;

/** Evaluate the monitor section with fakes; returns handles to drive it. */
function harness({ env = {} } = {}) {
  const state = {
    warns: [],
    snapshots: [],
    tick: null,
    intervalMs: null,
    unrefd: false,
    heap: { used_heap_size: 0, heap_size_limit: 1000 },
    dir: mkdtempSync(join(tmpdir(), "ksjt-heap-monitor-")),
  };
  const fakeProcess = {
    env: { COVEN_CAVE_HOME: state.dir, ...env },
    memoryUsage: () => ({ rss: 500 * 1024 * 1024, external: 10 * 1024 * 1024 }),
    uptime: () => 3600,
    pid: 4242,
  };
  const fakeConsole = {
    warn: (...args) => state.warns.push(args.join(" ")),
  };
  const fakeSetInterval = (fn, ms) => {
    state.tick = fn;
    state.intervalMs = ms;
    return { unref: () => { state.unrefd = true; } };
  };
  const fakeWriteHeapSnapshot = (file) => {
    writeFileSync(file, "{}");
    state.snapshots.push(file);
  };
  // The section references `sessions` (PTY session map) for log context.
  const sessions = new Map();

  const factory = new Function(
    "process", "console", "setInterval",
    "getHeapStatistics", "writeHeapSnapshot",
    "mkdirSync", "readdirSync", "unlinkSync", "join", "homedir", "sessions",
    `${section}\nstartHeapMonitor();`,
  );
  factory(
    fakeProcess, fakeConsole, fakeSetInterval,
    () => state.heap, fakeWriteHeapSnapshot,
    (dir, opts) => mkdirSync(dir, opts),
    (dir) => readdirSync(dir),
    (file) => rmSync(file),
    join,
    () => state.dir,
    sessions,
  );
  return state;
}

// ── Disabled by env kill-switch: no timer is ever registered ─────────────────
{
  const h = harness({ env: { COVEN_CAVE_HEAP_MONITOR: "0" } });
  assert.equal(h.tick, null, "COVEN_CAVE_HEAP_MONITOR=0 disables the monitor");
  rmSync(h.dir, { recursive: true, force: true });
}

// ── Quiet under the watermark; warns above it; snapshots near the limit ──────
{
  const h = harness();
  assert.ok(h.tick, "monitor registers its interval tick");
  assert.equal(h.intervalMs, 300_000, "default interval is 5 minutes");
  assert.equal(h.unrefd, true, "the timer is unref'd");

  h.heap = { used_heap_size: 500, heap_size_limit: 1000 }; // 50%
  h.tick();
  assert.equal(h.warns.length, 0, "healthy heap logs nothing");

  h.heap = { used_heap_size: 900, heap_size_limit: 1000 }; // 90%
  h.tick();
  assert.equal(h.warns.length, 1, "crossing 85% logs a structured warning");
  assert.match(h.warns[0], /\[heap-monitor\] heapUsed=/, "warning is namespaced + structured");
  assert.match(h.warns[0], /ptySessions=0/, "warning carries PTY session count context");
  assert.equal(h.snapshots.length, 0, "85-95% warns without snapshotting");

  h.heap = { used_heap_size: 960, heap_size_limit: 1000 }; // 96%
  h.tick();
  assert.equal(h.snapshots.length, 1, "crossing 95% writes the episode's heap snapshot");
  assert.match(h.snapshots[0], /cave-heap-.*-pid4242-\d{3}\.heapsnapshot$/, "snapshot name carries timestamp + pid + seq");

  h.tick(); // still at 96%
  assert.equal(h.snapshots.length, 1, "one snapshot per high-heap episode (latched)");

  h.heap = { used_heap_size: 400, heap_size_limit: 1000 }; // recovered
  h.tick();
  h.heap = { used_heap_size: 970, heap_size_limit: 1000 }; // second episode
  h.tick();
  assert.equal(h.snapshots.length, 2, "recovery below the watermark re-arms the snapshot latch");

  rmSync(h.dir, { recursive: true, force: true });
}

// ── Snapshot retention stays bounded ─────────────────────────────────────────
{
  const h = harness({ env: { COVEN_CAVE_HEAP_MONITOR_INTERVAL_MS: "1234" } });
  assert.equal(h.intervalMs, 1234, "interval is env-tunable");

  for (let episode = 0; episode < 4; episode++) {
    h.heap = { used_heap_size: 100, heap_size_limit: 1000 };
    h.tick(); // re-arm
    h.heap = { used_heap_size: 990, heap_size_limit: 1000 };
    h.tick(); // snapshot
  }
  assert.equal(h.snapshots.length, 4, "four episodes wrote four snapshots");
  const kept = readdirSync(join(h.dir, "diagnostics")).filter((f) => f.endsWith(".heapsnapshot"));
  assert.equal(kept.length, 2, "diagnostics dir keeps only the newest snapshots");

  rmSync(h.dir, { recursive: true, force: true });
}

console.log("server-heap-monitor.test.ts: ok");
