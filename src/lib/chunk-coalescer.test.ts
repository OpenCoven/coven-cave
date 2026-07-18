// @ts-nocheck
/**
 * Tests for src/lib/chunk-coalescer.ts (cave-w50e): the buffer that collapses
 * per-token SSE frames into one state update per flush window.
 *
 * Covers, with injectable timers:
 *  1. pushes accumulate; the scheduled flush applies ONE concatenated string
 *  2. only one timer is scheduled per window (no timer-per-token)
 *  3. explicit flush() applies immediately and cancels the pending timer
 *  4. flush() with an empty buffer never calls apply
 *  5. empty-string pushes are no-ops (no timer, no apply)
 *  6. the coalescer keeps working after a flush (next window schedules again)
 *  7. real-timer smoke: a scheduled flush actually fires
 */

import assert from "node:assert/strict";
import { createChunkCoalescer } from "./chunk-coalescer.ts";

function makeTimers() {
  let nextId = 1;
  const scheduled = new Map();
  return {
    schedule: (fn, ms) => {
      const id = nextId++;
      scheduled.set(id, { fn, ms });
      return id;
    },
    cancel: (id) => {
      scheduled.delete(id);
    },
    fire: () => {
      const entries = [...scheduled.entries()];
      scheduled.clear();
      for (const [, { fn }] of entries) fn();
    },
    count: () => scheduled.size,
  };
}

// ── 1 + 2. accumulate, single timer, one concatenated apply ─────────────────
{
  const timers = makeTimers();
  const applied = [];
  const c = createChunkCoalescer({
    flushMs: 40,
    apply: (text) => applied.push(text),
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  c.push("Hel");
  c.push("lo ");
  c.push("world");
  assert.equal(timers.count(), 1, "one timer per flush window, not per token");
  assert.deepEqual(applied, [], "nothing applies before the flush");
  assert.equal(c.pending(), "Hello world".length);
  timers.fire();
  assert.deepEqual(applied, ["Hello world"], "the flush applies one concatenated string");
  assert.equal(c.pending(), 0);
}

// ── 3. explicit flush applies now and cancels the timer ─────────────────────
{
  const timers = makeTimers();
  const applied = [];
  const c = createChunkCoalescer({
    flushMs: 40,
    apply: (t) => applied.push(t),
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  c.push("abc");
  c.flush();
  assert.deepEqual(applied, ["abc"]);
  assert.equal(timers.count(), 0, "explicit flush cancels the scheduled timer");
  timers.fire(); // nothing scheduled — must not double-apply
  assert.deepEqual(applied, ["abc"]);
}

// ── 4. empty flush never calls apply ─────────────────────────────────────────
{
  const timers = makeTimers();
  let calls = 0;
  const c = createChunkCoalescer({
    flushMs: 40,
    apply: () => { calls += 1; },
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  c.flush();
  assert.equal(calls, 0, "flushing an empty buffer is a no-op");
}

// ── 5. empty-string pushes are no-ops ────────────────────────────────────────
{
  const timers = makeTimers();
  let calls = 0;
  const c = createChunkCoalescer({
    flushMs: 40,
    apply: () => { calls += 1; },
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  c.push("");
  assert.equal(timers.count(), 0, "an empty chunk must not schedule a flush");
  timers.fire();
  assert.equal(calls, 0);
}

// ── 6. subsequent windows schedule again ─────────────────────────────────────
{
  const timers = makeTimers();
  const applied = [];
  const c = createChunkCoalescer({
    flushMs: 40,
    apply: (t) => applied.push(t),
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  c.push("one");
  timers.fire();
  c.push("two");
  assert.equal(timers.count(), 1, "a new window schedules a fresh timer");
  timers.fire();
  assert.deepEqual(applied, ["one", "two"]);
}

// ── 7. real-timer smoke ──────────────────────────────────────────────────────
{
  const applied = [];
  const c = createChunkCoalescer({ flushMs: 5, apply: (t) => applied.push(t) });
  c.push("re");
  c.push("al");
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(applied, ["real"], "default timers flush on their own");
}

console.log("chunk-coalescer.test.ts: all assertions passed");
