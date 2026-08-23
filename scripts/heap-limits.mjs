// The one place that decides how much old-space V8 may give a Cave server.
//
// Before this file, nothing chose it. `scripts/dev-app.sh` started the Next dev
// server as a bare `pnpm dev`, and `src-tauri/src/sidecar_startup.rs` spawned
// the packaged sidecar as `node <server.mjs>` with the entry path as its only
// argument. Neither passed `--max-old-space-size`, and nothing in src/, scripts/
// or package.json set NODE_OPTIONS for them — the two NODE_OPTIONS references
// in the tree (src/lib/vault.ts, src/lib/child-spawn-env.ts) STRIP it from child
// environments. So both processes ran at whatever ceiling V8 derives from host
// memory: ~4.3 GB on a 64 GB workstation, materially less on a small laptop.
// That is a ceiling nobody picked, and it varies per machine.
//
// Two things depend on the ceiling being a known number:
//
//   1. server.ts's [heap-monitor] (cave-ksjt) warns at 85% of the V8 limit and
//      writes ONE heap snapshot per episode at 95%. Those percentages only mean
//      something operationally if the denominator is the same everywhere.
//   2. `bash scripts/dev-app.sh` sessions die with "Ineffective mark-compacts
//      near heap limit" after hours (cave-ksjt logged 9.1h, 5.75h, 37.2h and
//      "a few hours" on the same box). How long you get before that is a
//      function of the ceiling, so an unchosen ceiling makes it unpredictable.
//
// WHAT THIS IS NOT. It is not a leak fix, and pinning a number does not slow
// the dev-session growth down by one byte. cave-r13x analysed two in-the-wild
// 5.3 GB / 5.8 GB captures and found the retention is entirely upstream dev
// toolchain — Turbopack HMR rebuild generations, React 19 dev debug capture,
// Flight dev registries — with no Cave constructor in either top-40. The dev
// remedy is still to restart the dev server; [heap-monitor]'s warn line is the
// loss-free signal to do it. This module only makes the ceiling deliberate.
//
// Rust cannot import this module. `src-tauri/src/sidecar_heap.rs` carries the
// same number and `scripts/heap-limits.test.mjs` fails if the copies disagree —
// the same two-place convention `scripts/ports.mjs` uses with
// `src-tauri/src/sidecar_ports.rs`.

/**
 * Old-space ceiling, in MiB, for every long-lived Cave Node server.
 *
 * 4096 is chosen so this change cannot break a session that works today: on
 * mainstream 16 GB+ hardware V8 already lands at ~4 GB unprompted, so pinning
 * it here is a no-op there and a FLOOR on smaller hosts, where V8's
 * memory-derived default is lower. It is not a reduction anywhere.
 *
 * Headroom against measurement: the packaged sidecar's own workload has been
 * measured three times and never came close. cave-ksjt saw the production
 * server hold a 39-42 MB heap across 12,360 crash-workload requests; cave-wgbk
 * saw 183.0 MB -> 182.4 MB RSS across 4,570 polls of the exact workspace from
 * the original incident, peaking at 300.1 MB. So 4096 MiB is roughly 90x the
 * measured heap and 13x the measured peak RSS.
 *
 * Change here AND in src-tauri/src/sidecar_heap.rs.
 */
export const CAVE_HEAP_LIMIT_MB = 4096;

/** Operator override, checked before the default. Mirrors CAVE_HEAP_LIMIT_ENV in Rust. */
export const CAVE_HEAP_LIMIT_ENV = "COVEN_CAVE_HEAP_LIMIT_MB";

/**
 * Bounds on an override.
 *
 * The floor exists because a cap that breaks normal use is worse than no cap:
 * 512 MiB is still comfortably above every measured working set, while a typo
 * like `COVEN_CAVE_HEAP_LIMIT_MB=64` would make the desktop app die on ordinary
 * traffic. The ceiling only rejects nonsense; 64 GiB is past any real host.
 */
export const CAVE_HEAP_LIMIT_MIN_MB = 512;
export const CAVE_HEAP_LIMIT_MAX_MB = 65536;

/**
 * Parses an override, returning null for anything that is not a usable limit.
 * Bare digits only — `4096mb`, `4g` and a negative are all refused rather than
 * silently truncated to something the operator did not ask for.
 */
export function parseHeapLimitMb(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return null;
  return parsed >= CAVE_HEAP_LIMIT_MIN_MB && parsed <= CAVE_HEAP_LIMIT_MAX_MB ? parsed : null;
}

/**
 * The ceiling a Cave server should run with.
 *
 * A malformed or out-of-range override falls back to the default rather than
 * refusing to start — same reasoning as `resolvePort`: a typo in a shell
 * profile should not stop the desktop app from launching, and the resolved
 * value is observable in the process's own argv either way.
 */
export function resolveHeapLimitMb(env = process.env) {
  return parseHeapLimitMb(env?.[CAVE_HEAP_LIMIT_ENV]) ?? CAVE_HEAP_LIMIT_MB;
}

/**
 * The V8 flags to launch a Cave server with.
 *
 * Returned as an array because ORDER IS LOAD-BEARING: node only reads V8 flags
 * that appear BEFORE the script path, so a caller that appends these after the
 * entry gets a silently uncapped process. Callers spread this ahead of the
 * entry; `sidecar_heap.rs` has the same contract and its own test for it.
 */
export function heapLimitNodeArgs(env = process.env) {
  return [`--max-old-space-size=${resolveHeapLimitMb(env)}`];
}

/**
 * The same ceiling expressed for NODE_OPTIONS, preserving anything the operator
 * already set. `scripts/dev-app.sh` uses this form because it starts the dev
 * server through `pnpm dev`, so it cannot insert argv ahead of the entry.
 */
export function heapLimitNodeOptions(env = process.env) {
  const existing = typeof env?.NODE_OPTIONS === "string" ? env.NODE_OPTIONS.trim() : "";
  const ours = heapLimitNodeArgs(env).join(" ");
  return existing ? `${existing} ${ours}` : ours;
}
