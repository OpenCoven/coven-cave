import assert from "node:assert/strict";
import test from "node:test";
import { createLiveGenerationRegistry } from "./live-chat-generations.ts";

type FakeTurn = { id: string; text: string };

function makeRegistry() {
  return createLiveGenerationRegistry<FakeTurn>((turn) => ({ ...turn }));
}

function controller() {
  return new AbortController();
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("record + read round-trips a snapshot with cloned turns", () => {
  const registry = makeRegistry();
  const turns = [{ id: "u1", text: "hi" }];
  registry.record({ sessionId: "s1", turns, activeLeafId: "u1", controller: controller(), updatedAt: 1 });
  const stored = registry.read("s1");
  assert.ok(stored);
  assert.deepEqual(stored.turns, turns);
  // Defensive clone: mutating the caller's array must not reach the registry.
  turns[0].text = "mutated";
  assert.equal(stored.turns[0].text, "hi");
});

test("advance accumulates chunks with no component involved (cave-0er)", () => {
  // The bug: routing accumulation through an unmounted component's setState
  // silently dropped every chunk after navigating away from the chat
  // surface. The registry must accumulate at module scope instead.
  const registry = makeRegistry();
  registry.record({
    sessionId: "s1",
    turns: [{ id: "a1", text: "" }],
    activeLeafId: "a1",
    controller: controller(),
    updatedAt: 1,
  });
  for (const chunk of ["Hel", "lo ", "world"]) {
    registry.advance("s1", (prev) => prev.map((t) => ({ ...t, text: t.text + chunk })), "a1");
  }
  assert.equal(registry.read("s1")?.turns[0].text, "Hello world");
});

test("advance refreshes updatedAt so a live stream never looks stale", () => {
  const registry = makeRegistry();
  registry.record({
    sessionId: "s1",
    turns: [{ id: "a1", text: "" }],
    activeLeafId: "a1",
    controller: controller(),
    updatedAt: 0,
  });
  const before = Date.now();
  registry.advance("s1", (prev) => prev, "a1");
  assert.ok((registry.read("s1")?.updatedAt ?? 0) >= before);
});

test("advance after settle/evict is a null no-op", () => {
  const registry = makeRegistry();
  assert.equal(registry.advance("gone", (prev) => prev, "a1"), null);
  registry.record({ sessionId: "s1", turns: [], activeLeafId: "", controller: controller(), updatedAt: 1 });
  registry.clear("s1");
  assert.equal(registry.advance("s1", (prev) => prev, "a1"), null);
});

test("record/advance return the stored snapshot listeners will receive", async () => {
  // The mounted view mirrors the returned snapshot synchronously; the
  // microtask notification must carry the SAME reference so the mirror's
  // setState bails instead of double-rendering.
  const registry = makeRegistry();
  const seen: unknown[] = [];
  registry.subscribe("s1", (snapshot) => seen.push(snapshot));
  const stored = registry.record({
    sessionId: "s1",
    turns: [{ id: "a1", text: "x" }],
    activeLeafId: "a1",
    controller: controller(),
    updatedAt: 1,
  });
  const advanced = registry.advance("s1", (prev) => prev, "a1");
  await flushMicrotasks();
  assert.equal(seen.length, 2);
  assert.equal(seen[0], stored);
  assert.equal(seen[1], advanced);
});

test("clear notifies null exactly once per call, even when already evicted", async () => {
  // Eviction path: a remounted view expires a quiet snapshot while the
  // orphaned stream keeps running. The stream's own clear-on-settle must
  // still notify so adopters reconcile from disk.
  const registry = makeRegistry();
  const seen: unknown[] = [];
  registry.subscribe("s1", (snapshot) => seen.push(snapshot));
  registry.record({ sessionId: "s1", turns: [], activeLeafId: "", controller: controller(), updatedAt: 1 });
  registry.clear("s1"); // eviction
  registry.clear("s1"); // orphaned stream settles later
  await flushMicrotasks();
  assert.deepEqual(seen.slice(1), [null, null]);
});

test("clear with a null/undefined session id does not notify", async () => {
  const registry = makeRegistry();
  const seen: unknown[] = [];
  registry.subscribe("", (snapshot) => seen.push(snapshot));
  registry.clear(null);
  registry.clear(undefined);
  await flushMicrotasks();
  assert.equal(seen.length, 0);
});

test("subscribe scopes notifications to the session and unsubscribes cleanly", async () => {
  const registry = makeRegistry();
  const forS1: unknown[] = [];
  const forS2: unknown[] = [];
  const unsubscribe = registry.subscribe("s1", (snapshot) => forS1.push(snapshot));
  registry.subscribe("s2", (snapshot) => forS2.push(snapshot));
  registry.record({ sessionId: "s1", turns: [], activeLeafId: "", controller: controller(), updatedAt: 1 });
  await flushMicrotasks();
  assert.equal(forS1.length, 1);
  assert.equal(forS2.length, 0);
  unsubscribe();
  registry.record({ sessionId: "s1", turns: [], activeLeafId: "", controller: controller(), updatedAt: 2 });
  await flushMicrotasks();
  assert.equal(forS1.length, 1);
});
