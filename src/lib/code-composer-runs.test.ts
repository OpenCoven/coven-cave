import assert from "node:assert/strict";
import { test } from "node:test";
import { IDLE_COMPOSER_RUN, createComposerRunStore } from "./code-composer-runs.ts";

test("a run survives without a subscriber and reads back as one stable snapshot", () => {
  const store = createComposerRunStore();
  assert.equal(store.read("s1"), IDLE_COMPOSER_RUN);
  const controller = new AbortController();
  assert.equal(store.begin("s1", "r1", controller), true);
  store.reply("s1", "r1", "Hal");
  store.reply("s1", "r1", "Half");
  const first = store.read("s1");
  assert.deepEqual(first, { phase: "streaming", runId: "r1", reply: "Half", message: null, restore: null });
  assert.equal(store.read("s1"), first, "unchanged state keeps the same object, as useSyncExternalStore requires");
  store.reply("s1", "r1", "Half");
  assert.equal(store.read("s1"), first, "an identical reply is not a change");
  assert.equal(store.read("s2"), IDLE_COMPOSER_RUN, "another session's run is independent");
});

test("a session runs one follow-up at a time; a late event from an old run is ignored", () => {
  const store = createComposerRunStore();
  store.begin("s1", "r1", new AbortController());
  assert.equal(store.begin("s1", "r2", new AbortController()), false, "no second send while one streams");
  store.finish("s1", "r1", { phase: "done", reply: "Done.", message: null, restore: null });
  assert.equal(store.begin("s1", "r2", new AbortController()), true);
  store.reply("s1", "r1", "stale text");
  store.finish("s1", "r1", { phase: "error", reply: "", message: "late", restore: null });
  assert.equal(store.read("s1").runId, "r2");
  assert.equal(store.read("s1").phase, "streaming");
  assert.equal(store.read("s1").reply, "");
});

test("stop aborts at once and is remembered for the run's own completion", () => {
  const store = createComposerRunStore();
  const controller = new AbortController();
  store.begin("s1", "r1", controller);
  assert.equal(store.stop("s1"), "r1");
  assert.equal(controller.signal.aborted, true);
  assert.equal(store.wasStopped("s1", "r1"), true);
  assert.equal(store.stop("s2"), null, "nothing to stop elsewhere");
  store.finish("s1", "r1", { phase: "stopped", reply: "", message: null, restore: "ask" });
  assert.equal(store.stop("s1"), null, "a finished run cannot be stopped again");
  assert.equal(store.read("s1").restore, "ask");
  store.ackRestore("s1");
  assert.equal(store.read("s1").restore, null);
});

test("subscribers hear every change; the store is bounded but never drops a live run", () => {
  const store = createComposerRunStore(2);
  let calls = 0;
  const unsubscribe = store.subscribe(() => (calls += 1));
  store.begin("live", "r", new AbortController());
  store.begin("a", "ra", new AbortController());
  store.finish("a", "ra", { phase: "done", reply: "x", message: null, restore: null });
  store.begin("b", "rb", new AbortController());
  store.finish("b", "rb", { phase: "done", reply: "y", message: null, restore: null });
  assert.equal(store.read("live").phase, "streaming", "the streaming run is kept over finished ones");
  assert.equal(store.read("a"), IDLE_COMPOSER_RUN, "the oldest finished run was evicted");
  assert.ok(calls >= 5);
  unsubscribe();
  const before = calls;
  store.begin("c", "rc", new AbortController());
  assert.equal(calls, before, "an unsubscribed listener hears nothing");
});
