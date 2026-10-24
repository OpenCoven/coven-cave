import assert from "node:assert/strict";
import test from "node:test";
import {
  createLiveGenerationRegistry,
  type LiveGenerationSnapshot,
} from "./live-chat-generations.ts";

type FakeTurn = { id: string; text: string };

function makeRegistry() {
  return createLiveGenerationRegistry<FakeTurn>((turn) => ({ ...turn }));
}

type MetadataSnapshot = LiveGenerationSnapshot<FakeTurn> & {
  runId: string;
  health: { phase: string; cursor: number };
};

function makeMetadataRegistry() {
  return createLiveGenerationRegistry<FakeTurn, MetadataSnapshot>((turn) => ({ ...turn }));
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

test("staged metadata rides the next coalesced turn advance without an extra notification", async () => {
  const registry = makeMetadataRegistry();
  const seen: Array<MetadataSnapshot | null> = [];
  registry.subscribe("s1", (snapshot) => seen.push(snapshot));
  registry.record({
    sessionId: "s1",
    turns: [{ id: "a1", text: "" }],
    activeLeafId: "a1",
    controller: controller(),
    updatedAt: 1,
    runId: "run-1",
    health: { phase: "connecting", cursor: 0 },
  });
  await flushMicrotasks();
  assert.equal(seen.length, 1);

  const staged = registry.stage("s1", (snapshot) => ({
    ...snapshot,
    health: { phase: "streaming", cursor: 7 },
  }));
  await flushMicrotasks();
  assert.equal(seen.length, 1);
  assert.equal(staged?.health.cursor, 7);

  const advanced = registry.advance(
    "s1",
    (turns) => turns.map((turn) => ({ ...turn, text: "hello" })),
    "a1",
  );
  await flushMicrotasks();
  assert.equal(seen.length, 2);
  assert.equal(advanced?.health.phase, "streaming");
  assert.equal(advanced?.health.cursor, 7);
  assert.equal(seen[1]?.health.cursor, 7);
});

test("staging after clear is a null no-op and cannot resurrect metadata", async () => {
  const registry = makeMetadataRegistry();
  registry.record({
    sessionId: "s1",
    turns: [],
    activeLeafId: "",
    controller: controller(),
    updatedAt: 1,
    runId: "run-1",
    health: { phase: "settled", cursor: 9 },
  });
  registry.clear("s1");

  const staged = registry.stage("s1", (snapshot) => ({
    ...snapshot,
    health: { phase: "streaming", cursor: 10 },
  }));
  await flushMicrotasks();

  assert.equal(staged, null);
  assert.equal(registry.read("s1"), null);
});

test("moving a run to its replacement session removes the origin alias", async () => {
  const registry = makeMetadataRegistry();
  assert.equal(typeof registry.move, "function", "registry exposes guarded key migration");
  registry.record({
    sessionId: "origin-a",
    turns: [{ id: "a1", text: "streaming" }],
    activeLeafId: "a1",
    controller: controller(),
    updatedAt: 1,
    runId: "run-old",
    health: { phase: "streaming", cursor: 3 },
  });

  const moved = registry.move(
    "origin-a",
    "replacement-b",
    (snapshot) => snapshot.runId === "run-old",
  );
  await flushMicrotasks();

  assert.equal(registry.read("origin-a"), null, "the origin key cannot remain as a zombie");
  assert.equal(moved?.sessionId, "replacement-b");
  assert.equal(registry.read("replacement-b")?.runId, "run-old");
});

test("guarded alias cleanup preserves a newer run under the origin key", async () => {
  const registry = makeMetadataRegistry();
  assert.equal(typeof registry.clearIf, "function", "registry exposes guarded cleanup");
  registry.record({
    sessionId: "origin-a",
    turns: [],
    activeLeafId: "",
    controller: controller(),
    updatedAt: 1,
    runId: "run-old",
    health: { phase: "streaming", cursor: 1 },
  });
  registry.move("origin-a", "replacement-b", (snapshot) => snapshot.runId === "run-old");
  registry.record({
    sessionId: "origin-a",
    turns: [],
    activeLeafId: "",
    controller: controller(),
    updatedAt: 2,
    runId: "run-new",
    health: { phase: "streaming", cursor: 0 },
  });

  assert.equal(
    registry.clearIf("origin-a", (snapshot) => snapshot.runId === "run-old"),
    false,
    "the old run cannot clear a replacement registered later under A",
  );
  assert.equal(
    registry.clearIf("replacement-b", (snapshot) => snapshot.runId === "run-old"),
    true,
    "the old run still clears its final alias",
  );
  await flushMicrotasks();

  assert.equal(registry.read("origin-a")?.runId, "run-new");
  assert.equal(registry.read("replacement-b"), null);
});

test("revocation drops queued snapshots and refuses late records from the revoked stream", async () => {
  const registry = makeRegistry();
  const stream = controller();
  const seen: unknown[] = [];
  registry.subscribe("revoked", (snapshot) => seen.push(snapshot));
  const snapshot = { sessionId: "revoked", turns: [{ id: "a", text: "restricted" }], activeLeafId: "a", controller: stream, updatedAt: 1 };
  registry.record(snapshot);
  registry.revoke("revoked");
  assert.equal(stream.signal.aborted, true);
  assert.equal(registry.read("revoked"), null);
  assert.equal(registry.record(snapshot), null);
  assert.equal(registry.advance("revoked", (turns) => turns, "a"), null);
  await Promise.resolve();
  assert.deepEqual(seen, [null]);
});

test("revoking all streams leaves a new independently authorized stream usable", async () => {
  const registry = makeRegistry();
  const old = controller();
  registry.record({ sessionId: "a", turns: [], activeLeafId: "", controller: old, updatedAt: 1 });
  registry.record({ sessionId: "b", turns: [], activeLeafId: "", controller: old, updatedAt: 1 });
  registry.revoke();
  assert.equal(registry.read("a"), null);
  assert.equal(registry.read("b"), null);
  assert.equal(old.signal.aborted, true);
  assert.ok(registry.record({ sessionId: "a", turns: [], activeLeafId: "", controller: controller(), updatedAt: 2 }));
  await Promise.resolve();
  assert.ok(registry.read("a"));
});

test("session revocation removes every alias sharing that stream but preserves unrelated runs", async () => {
  const registry = makeRegistry();
  const shared = controller();
  for (const sessionId of ["origin", "replacement"]) {
    registry.record({ sessionId, turns: [], activeLeafId: "", controller: shared, updatedAt: 1 });
  }
  registry.record({ sessionId: "other", turns: [], activeLeafId: "", controller: controller(), updatedAt: 1 });
  registry.revoke("origin");
  await Promise.resolve();
  assert.equal(registry.read("origin"), null);
  assert.equal(registry.read("replacement"), null);
  assert.ok(registry.read("other"));
});

test("stream access guard fences delayed callbacks across session aliases without redispatch", async () => {
  const { createChatStreamAccessGuard, invalidateChatAccess } = await import("./chat-access-invalidation.ts");
  const stream = controller();
  const aliases = new Set(["origin"]);
  const guard = createChatStreamAccessGuard(stream, () => aliases);
  try {
    invalidateChatAccess({ sessionId: "unrelated", reason: "denied" });
    assert.equal(guard.revoked(), false);
    aliases.add("replacement");
    invalidateChatAccess({ sessionId: "replacement", reason: "denied" });
    assert.equal(guard.revoked(), true);
    assert.equal(stream.signal.aborted, true);
    let publications = 0;
    await Promise.resolve().then(() => { if (!guard.revoked()) publications += 1; });
    assert.equal(publications, 0);
  } finally { guard.dispose(); }
});
