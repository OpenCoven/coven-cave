import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pendingHistorySystemTurns, startChatTranscriptLoad } from "./chat-transcript-load.ts";

test("pending history may retain informational notices, but not replace sends, edits or resets", () => {
  const user = { role: "user", text: "Saved question" };
  const assistant = { role: "assistant", text: "Saved answer" };
  const help = { role: "system", text: "Local help" };
  const painted = [user, assistant];
  assert.deepEqual(pendingHistorySystemTurns(painted, painted), []);
  assert.deepEqual(pendingHistorySystemTurns(painted, [...painted, help]), [help]);
  assert.equal(pendingHistorySystemTurns(painted, [...painted, { role: "user", text: "New send" }]), null);
  assert.equal(pendingHistorySystemTurns(painted, [user, { ...assistant, text: "Edited answer" }]), null);
  assert.equal(pendingHistorySystemTurns(painted, []), null);
  assert.equal(pendingHistorySystemTurns([], []), null, "clear during an initially empty load remains a reset");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("network starts immediately alongside cache and never awaits slow decryption", async () => {
  const order: string[] = [];
  const cache = deferred<string | null>();
  const network = deferred<string | null>();
  const painted: string[] = [];
  const load = startChatTranscriptLoad({
    loadNetwork: () => { order.push("network"); return network.promise; },
    loadDurable: () => { order.push("cache"); return cache.promise; },
    onPendingDurable: (payload) => painted.push(payload),
  });
  assert.deepEqual(order, ["network", "cache"]);
  network.resolve("fresh");
  assert.equal(await load.network, "fresh");
  cache.resolve("old");
  assert.equal(await load.durable, "old");
  assert.deepEqual(painted, [], "late offline data never overwrites network truth");
});

test("fast durable cache paints once while network is pending", async () => {
  const cache = deferred<string | null>();
  const network = deferred<string | null>();
  const painted: string[] = [];
  const load = startChatTranscriptLoad({
    loadNetwork: () => network.promise,
    loadDurable: () => cache.promise,
    onPendingDurable: (payload) => painted.push(payload),
  });
  cache.resolve("durable");
  await load.durable;
  assert.deepEqual(painted, ["durable"]);
  network.resolve("fresh");
  assert.equal(await load.network, "fresh");
});

test("network failure settles promptly and durable stays available for explicit fallback", async () => {
  const cache = deferred<string | null>();
  const network = deferred<string | null>();
  const painted: string[] = [];
  const load = startChatTranscriptLoad({
    loadNetwork: () => network.promise,
    loadDurable: () => cache.promise,
    onPendingDurable: (payload) => painted.push(payload),
  });
  const rejection = assert.rejects(load.network, /offline/);
  network.reject(new Error("offline"));
  await rejection;
  cache.resolve("saved");
  assert.equal(await load.durable, "saved");
  assert.deepEqual(painted, [], "failure also closes automatic cache painting");
});

test("cache failure cannot fail successful network history", async () => {
  const load = startChatTranscriptLoad({
    loadNetwork: async () => "fresh",
    loadDurable: async () => { throw new Error("decrypt"); },
    onPendingDurable: () => assert.fail("no valid cache"),
  });
  assert.equal(await load.network, "fresh");
  assert.equal(await load.durable, null);
});

test("caller ownership guards can refuse cache paint after a live generation or switch", async () => {
  for (const reason of ["live", "switched"]) {
    const cache = deferred<string | null>();
    const network = deferred<string | null>();
    let ownsHistory = true;
    const painted: string[] = [];
    const load = startChatTranscriptLoad({
      loadNetwork: () => network.promise,
      loadDurable: () => cache.promise,
      onPendingDurable: (payload) => { if (ownsHistory) painted.push(payload); },
    });
    ownsHistory = false;
    cache.resolve("stale");
    await load.durable;
    assert.deepEqual(painted, [], reason);
    network.resolve("fresh");
    await load.network;
  }
});

test("ChatView keeps cancellation, generation/reset and equality guards around concurrent loads", () => {
  const source = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
  assert.match(source, /hasLiveGeneration\(\) \|\| pendingHistorySystemTurns\(paintedTurns, turnsRef\.current\) === null/);
  assert.match(source, /transcriptResetRevisionRef\.current !== resetRevision/);
  assert.equal((source.match(/transcriptResetRevisionRef\.current \+= 1/g) ?? []).length, 3, "every explicit clear surface fences history");
  assert.match(source, /localSystemTurns = \[\.\.\.localSystemTurns, \.\.\.additions\];/);
  assert.match(source, /applyConversationPayload\(payload, localSystemTurns\)/);
  assert.match(source, /if \(cancelled \|\| hasNewerGeneration\(\)\) return;/);
  assert.match(source, /const emptyTurns: Turn\[\] = \[\];\s*setTurns\(emptyTurns\);\s*turnsRef\.current = emptyTurns;/);
  assert.match(source, /paintedConversation &&\s*sameConversationRevision\(/);
  assert.match(source, /onPendingDurable: paintDurable/);
  assert.match(source, /if \(!\(error instanceof ConversationLoadError && error\.status === 404\)\) \{\s*const durable = await historyLoad\.durable;/);
  assert.match(source, /return \(\) => \{\s*cancelled = true;/);
});
