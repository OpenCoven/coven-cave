// @ts-nocheck
/**
 * Tests for src/lib/swr-cache.ts (cave-5m1c): the stale-while-revalidate
 * cache behind /api/sessions/list.
 *
 * Covers, with an injectable fake clock:
 *  1. cold start awaits the compute
 *  2. fresh window serves cached without recomputing
 *  3. stale window serves the OLD value instantly and revalidates in the
 *     background (next read sees the new value)
 *  4. beyond the stale window the caller blocks on a fresh compute
 *  5. concurrent callers share one in-flight compute (dedupe)
 *  6. canServeStale=false entries (e.g. error payloads) are never served
 *     stale — the caller re-awaits the compute
 *  7. background revalidation failure keeps serving the stale value
 *  8. keys are independent
 *  9. clear() drops entries
 * 10. invalidate(key) drops that key only — next get recomputes
 * 11. invalidate during an in-flight compute starts a new versioned request
 *     instead of reusing the stale in-flight one
 * 12. a pre-invalidation request that resolves late must not overwrite the
 *     newer cache entry
 */

import assert from "node:assert/strict";
import { createSwrCache } from "./swr-cache.ts";

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/** Deferred compute helper: counts calls, resolves what you tell it to. */
function makeCompute(values) {
  let calls = 0;
  const fn = async () => {
    const value = values[Math.min(calls, values.length - 1)];
    calls += 1;
    if (value instanceof Error) throw value;
    return value;
  };
  return { fn, count: () => calls };
}

const TTL = 2000;
const STALE = 30_000;

// ── 1 + 2. cold start computes; fresh window serves without recompute ───────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  const compute = makeCompute(["v1", "v2"]);
  assert.equal(await cache.get("k", compute.fn), "v1");
  assert.equal(compute.count(), 1);
  clock.advance(TTL); // age == ttl: still fresh
  assert.equal(await cache.get("k", compute.fn), "v1");
  assert.equal(compute.count(), 1, "fresh hit must not recompute");
}

// ── 3. stale serve + background revalidate ───────────────────────────────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  const compute = makeCompute(["v1", "v2"]);
  await cache.get("k", compute.fn);
  clock.advance(TTL + 1); // stale but servable
  assert.equal(await cache.get("k", compute.fn), "v1", "stale read returns the old value instantly");
  assert.equal(compute.count(), 2, "stale read must kick a background revalidation");
  await Promise.resolve(); // let the background compute settle
  await Promise.resolve();
  assert.equal(await cache.get("k", compute.fn), "v2", "next read sees the revalidated value");
  assert.equal(compute.count(), 2, "the revalidated entry is fresh again — no extra compute");
}

// ── 4. beyond the stale window the caller blocks on a fresh value ───────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  const compute = makeCompute(["v1", "v2"]);
  await cache.get("k", compute.fn);
  clock.advance(STALE + 1);
  assert.equal(await cache.get("k", compute.fn), "v2", "expired entries are not served");
  assert.equal(compute.count(), 2);
}

// ── 5. concurrent callers share one in-flight compute ───────────────────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const compute = async () => { calls += 1; await gate; return "shared"; };
  const a = cache.get("k", compute);
  const b = cache.get("k", compute);
  release();
  assert.deepEqual(await Promise.all([a, b]), ["shared", "shared"]);
  assert.equal(calls, 1, "concurrent cold callers must share one compute");
}

// ── 6. non-servable entries are never served stale ──────────────────────────
{
  const clock = makeClock();
  const cache = createSwrCache({
    ttlMs: TTL,
    staleServeMs: STALE,
    canServeStale: (v) => v.ok,
    now: clock.now,
  });
  const compute = makeCompute([{ ok: false, v: 1 }, { ok: true, v: 2 }]);
  assert.deepEqual(await cache.get("k", compute.fn), { ok: false, v: 1 });
  clock.advance(TTL + 1);
  assert.deepEqual(
    await cache.get("k", compute.fn),
    { ok: true, v: 2 },
    "an error payload must not be pinned for the stale window — recompute instead",
  );
  assert.equal(compute.count(), 2);
}

// ── 7. background revalidation failure keeps the stale value ────────────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  const compute = makeCompute(["v1", new Error("daemon down"), "v3"]);
  await cache.get("k", compute.fn);
  clock.advance(TTL + 1);
  assert.equal(await cache.get("k", compute.fn), "v1"); // kicks failing revalidation
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    await cache.get("k", compute.fn),
    "v1",
    "failed revalidation must not clobber the served value",
  );
  // The failed revalidation cleared in-flight, so this stale read retries…
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await cache.get("k", compute.fn), "v3", "…and a later success replaces it");
}

// ── 8. keys are independent ──────────────────────────────────────────────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  assert.equal(await cache.get("a", async () => "va"), "va");
  assert.equal(await cache.get("b", async () => "vb"), "vb");
}

// ── 9. clear() drops entries ─────────────────────────────────────────────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  const compute = makeCompute(["v1", "v2"]);
  await cache.get("k", compute.fn);
  cache.clear();
  assert.equal(await cache.get("k", compute.fn), "v2");
  assert.equal(compute.count(), 2);
}

// ── 10. invalidate(key) drops that key only ──────────────────────────────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  const computeA = makeCompute(["a1", "a2"]);
  const computeB = makeCompute(["b1", "b2"]);
  await cache.get("a", computeA.fn);
  await cache.get("b", computeB.fn);
  cache.invalidate("a");
  assert.equal(await cache.get("a", computeA.fn), "a2", "invalidated key recomputes while fresh");
  assert.equal(await cache.get("b", computeB.fn), "b1", "other keys keep their fresh entries");
  assert.equal(computeA.count(), 2);
  assert.equal(computeB.count(), 1);
}

// ── 11. invalidate during an in-flight compute starts a fresh request ─────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  await cache.get("k", async () => "v1");
  let calls = 0;
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((r) => { releaseFirst = r; });
  const secondGate = new Promise((r) => { releaseSecond = r; });
  const compute = async () => {
    calls += 1;
    if (calls === 1) {
      await firstGate;
      return "v2";
    }
    await secondGate;
    return "v3";
  };
  cache.invalidate("k");
  const first = cache.get("k", compute);
  cache.invalidate("k");
  const second = cache.get("k", compute);
  releaseSecond();
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["v2", "v3"]);
  assert.equal(calls, 2, "a later invalidate must bypass the older in-flight request");
}

// ── 12. late stale completions cannot repopulate the current cache ────────────
{
  const clock = makeClock();
  const cache = createSwrCache({ ttlMs: TTL, staleServeMs: STALE, now: clock.now });
  let releaseStale;
  let releaseFresh;
  const staleGate = new Promise((r) => { releaseStale = r; });
  const freshGate = new Promise((r) => { releaseFresh = r; });
  let calls = 0;
  const compute = async () => {
    calls += 1;
    if (calls === 1) {
      await staleGate;
      return "stale";
    }
    await freshGate;
    return "fresh";
  };

  const stale = cache.get("k", compute);
  cache.invalidate("k");
  const fresh = cache.get("k", compute);
  releaseFresh();
  assert.equal(await fresh, "fresh");
  releaseStale();
  assert.equal(await stale, "stale");
  assert.equal(await cache.get("k", compute), "fresh");
  assert.equal(calls, 2, "the stale completion must not overwrite the fresh cache entry");
}

console.log("swr-cache.test.ts: all assertions passed");
