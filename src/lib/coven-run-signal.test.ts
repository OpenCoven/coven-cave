import assert from "node:assert/strict";
import test from "node:test";

import {
  covenRunPillServerSnapshot,
  covenRunPillSnapshot,
  publishCovenRunPill,
  resetCovenRunPillForTests,
  subscribeCovenRunPill,
} from "./coven-run-signal.ts";
import type { CovenRunPill } from "./coven-run.ts";

function pill(patch: Partial<CovenRunPill> = {}): CovenRunPill {
  return {
    label: "Round robin",
    tone: "accent",
    icon: "ph:arrows-clockwise",
    live: true,
    startedAtMs: 1_000,
    elapsedMs: 0,
    ...patch,
  };
}

test("subscribers see the published pill", () => {
  resetCovenRunPillForTests();
  let woke = 0;
  const stop = subscribeCovenRunPill(() => { woke += 1; });
  publishCovenRunPill(pill());
  assert.equal(woke, 1);
  assert.equal(covenRunPillSnapshot()?.label, "Round robin");
  stop();
});

test("an unchanged pill never wakes the status bar", () => {
  resetCovenRunPillForTests();
  let woke = 0;
  const stop = subscribeCovenRunPill(() => { woke += 1; });
  publishCovenRunPill(pill());
  publishCovenRunPill(pill());
  publishCovenRunPill(pill());
  // The publisher re-derives on every streamed token; without this the whole
  // workspace footer would repaint at token rate.
  assert.equal(woke, 1, "identical pills must not notify");
  publishCovenRunPill(pill({ label: "Paused", tone: "warning", live: false }));
  assert.equal(woke, 2, "a real change must notify");
  stop();
});

test("the snapshot is stable between publishes", () => {
  resetCovenRunPillForTests();
  publishCovenRunPill(pill());
  // useSyncExternalStore loops if the snapshot identity changes each call.
  assert.equal(covenRunPillSnapshot(), covenRunPillSnapshot());
});

test("clearing is a real transition, and idempotent", () => {
  resetCovenRunPillForTests();
  let woke = 0;
  const stop = subscribeCovenRunPill(() => { woke += 1; });
  publishCovenRunPill(pill());
  publishCovenRunPill(null);
  assert.equal(covenRunPillSnapshot(), null);
  assert.equal(woke, 2);
  publishCovenRunPill(null);
  assert.equal(woke, 2, "clearing an already-clear slot must not notify");
  stop();
});

test("unsubscribing stops the wakeups", () => {
  resetCovenRunPillForTests();
  let woke = 0;
  const stop = subscribeCovenRunPill(() => { woke += 1; });
  stop();
  publishCovenRunPill(pill());
  assert.equal(woke, 0);
});

test("a listener added during a notify does not break the pass", () => {
  resetCovenRunPillForTests();
  const seen: string[] = [];
  const stop = subscribeCovenRunPill(() => {
    seen.push("first");
    subscribeCovenRunPill(() => seen.push("late"));
  });
  publishCovenRunPill(pill());
  assert.deepEqual(seen, ["first"], "the snapshot of listeners is taken before notifying");
  stop();
});

test("the server snapshot is always empty", () => {
  resetCovenRunPillForTests();
  publishCovenRunPill(pill());
  assert.equal(covenRunPillServerSnapshot(), null);
});
