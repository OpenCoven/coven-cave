import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { ConversationLoadError } from "../conversation-cache.ts";
import type { ConversationHistoryPayload, Turn } from "../chat-turn-state.ts";
import { startChatHistoryLoad, type ChatHistorySources, type ChatHistoryView } from "./history-load.ts";

const createdAt = "2026-10-05T00:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function payload(text: string, revision = text): ConversationHistoryPayload {
  return { ok: true, conversation: { activeLeafId: "answer", turns: [{ id: "answer", role: "assistant", text }], ...{ updatedAt: revision } } };
}
async function flush() { await setImmediate(); }
function fixture({ memory = null, switched = true, flow = false }: {
  memory?: ConversationHistoryPayload | null; switched?: boolean; flow?: boolean;
} = {}) {
  const network = deferred<ConversationHistoryPayload | null>();
  const durable = deferred<ConversationHistoryPayload | null>();
  const flowTranscript = deferred<string | null>();
  let turns: Turn[] = [{ id: "previous", role: "user", createdAt, text: "Previous thread" }];
  let currentTurns = turns;
  let state = "idle";
  let activeLeafId = "previous";
  let fallback: string | null = null;
  let resetRevision = 0;
  let live = false;
  let keepLive = false;
  let paints = 0;
  let context: ConversationHistoryPayload["context"] = null;
  const events: string[] = [];
  const writes: ConversationHistoryPayload[] = [];
  const view: ChatHistoryView = {
    readTurns: () => currentTurns,
    syncTurns: (value) => { currentTurns = value; },
    readResetRevision: () => resetRevision,
    hasLiveGeneration: () => live,
    keepLiveSession: () => keepLive,
    setTurns: (value) => { turns = value; events.push("turns"); },
    setActiveLeafId: (value) => { activeLeafId = value; },
    setState: (value) => { state = value; events.push(`state:${value}`); },
    setContext: (value) => { context = value; },
    setFallback: (value) => { fallback = value; },
    onPaint: () => { paints += 1; },
  };
  const sources: ChatHistorySources = {
    readMemory: () => memory,
    loadNetwork: () => { events.push("network"); return network.promise; },
    loadDurable: () => { events.push("durable"); return durable.promise; },
    persist: (_id, value) => { writes.push(value); },
    loadFlowTranscript: () => { events.push("flow"); return flowTranscript.promise; },
    isMissingError: (error) => error instanceof ConversationLoadError && error.status === 404,
  };
  const cancel = startChatHistoryLoad({ sessionId: "chat", isThreadSwitch: switched, flowBackedSession: flow, sources, view });
  return {
    network, durable, flowTranscript, events, writes, cancel,
    get ownedTurns() { return currentTurns; },
    get turns() { return turns; }, get state() { return state; }, get paints() { return paints; },
    get activeLeafId() { return activeLeafId; }, get fallback() { return fallback; }, get context() { return context; },
    changeTurns(value: Turn[]) { turns = currentTurns = value; },
    reset() { resetRevision += 1; turns = currentTurns = []; },
    resetBeforeCommit() { resetRevision += 1; turns = []; },
    startLive() { live = true; }, stopLive() { live = false; },
    keepLive() { keepLive = true; },
  };
}

test("switch clears the old thread and starts network and durable reads together", async () => {
  const f = fixture();
  assert.equal(f.turns.length, 0);
  assert.equal(f.ownedTurns, f.turns, "a switch clears display and ownership with the same array");
  assert.equal(f.activeLeafId, "");
  assert.equal(f.state, "loading");
  assert.ok(f.events.indexOf("network") < f.events.indexOf("durable"));
  f.network.resolve(payload("Fresh"));
  await flush();
  assert.equal(f.state, "loaded");
  assert.equal(f.turns[0].text, "Fresh");
  assert.equal(f.paints, 1);
  f.durable.resolve(payload("Late old copy"));
  await flush();
  assert.equal(f.turns[0].text, "Fresh");
  assert.equal(f.paints, 1);
});

test("memory paints immediately; equal revision preserves turn identity and skips durable decryption", async () => {
  const f = fixture({ memory: payload("Saved", "v1") });
  const painted = f.turns;
  assert.equal(f.state, "loaded");
  assert.equal(f.paints, 1);
  assert.ok(!f.events.includes("durable"));
  f.network.resolve(payload("Saved", "v1"));
  await flush();
  assert.equal(f.turns, painted);
  assert.equal(f.paints, 1);
});

test("same-session revalidation retains visible turns while the request is pending", async () => {
  const f = fixture({ switched: false });
  assert.equal(f.turns[0].id, "previous");
  f.network.resolve(payload("Changed"));
  await flush();
  assert.equal(f.turns[0].text, "Changed");
  f.durable.resolve(null);
});

test("durable cache paints a sendable revalidating state, then fresh network replaces it", async () => {
  const f = fixture();
  f.durable.resolve(payload("Offline copy"));
  await flush();
  assert.equal(f.state, "revalidating");
  assert.equal(f.turns[0].text, "Offline copy");
  f.network.resolve(payload("Fresh"));
  await flush();
  assert.equal(f.state, "loaded");
  assert.equal(f.turns[0].text, "Fresh");
  assert.equal(f.paints, 2);
  assert.equal(f.writes.length, 1);
});

test("system notices survive both durable paint and network refresh exactly once", async () => {
  const f = fixture();
  const first: Turn = { id: "notice-1", role: "system", createdAt, text: "Local help" };
  const second: Turn = { id: "notice-2", role: "system", createdAt, text: "Another notice" };
  f.changeTurns([...f.turns, first]);
  f.durable.resolve(payload("Cached"));
  await flush();
  f.changeTurns([...f.turns, second]);
  f.network.resolve(payload("Fresh"));
  await flush();
  assert.deepEqual(f.turns.map(t => t.id), ["answer", "notice-1", "notice-2"]);
  assert.equal(f.turns[1], first);
  assert.equal(f.turns[2], second);
});

for (const superseding of ["live", "settled-send", "edit", "reset"] as const) {
  test(`${superseding} fences pending durable and network history`, async () => {
    const f = fixture({ memory: payload("Saved") });
    if (superseding === "live") f.startLive();
    if (superseding === "settled-send") f.changeTurns([...f.turns, { id: "new", role: "user", createdAt, text: "Sent and settled" }]);
    if (superseding === "edit") f.changeTurns(f.turns.map(turn => ({ ...turn, text: "Edited" })));
    if (superseding === "reset") f.reset();
    const owned = f.turns;
    f.network.resolve(payload("Stale"));
    f.durable.resolve(payload("Stale cache"));
    await flush();
    assert.equal(f.turns, owned);
    assert.equal(f.writes.length, 0);
    assert.equal(f.state, "loaded");
  });
}

test("empty reset and active generation also fence a cold durable cache paint", async () => {
  for (const action of ["reset", "live", "send"] as const) {
    const f = fixture();
    if (action === "reset") f.reset();
    if (action === "live") f.startLive();
    if (action === "send") f.changeTurns([{ id: "new", role: "user", createdAt, text: "New" }]);
    const owned = f.turns;
    f.durable.resolve(payload("Old copy"));
    await flush();
    assert.equal(f.turns, owned);
    assert.equal(f.paints, 0);
    f.network.resolve(payload("Old network"));
    await flush();
    assert.equal(f.turns, owned);
  }
});

test("cancellation fences late success, failure and durable paint", async () => {
  for (const fails of [false, true]) {
    const f = fixture();
    f.cancel();
    const events = [...f.events];
    f.durable.resolve(payload("Old"));
    if (fails) f.network.reject(new Error("offline")); else f.network.resolve(payload("Old"));
    await flush();
    assert.deepEqual(f.events, events);
    assert.equal(f.paints, 0);
    assert.equal(f.writes.length, 0);
  }
});

test("network failure awaits slow durable cache, then becomes offline without losing the transcript", async () => {
  const f = fixture();
  f.network.reject(new Error("offline"));
  await flush();
  assert.equal(f.state, "loading");
  f.durable.resolve(payload("Saved"));
  await flush();
  assert.equal(f.state, "offline");
  assert.equal(f.turns[0].text, "Saved");
});

test("ownership is rechecked after failure waits for durable decryption", async () => {
  for (const action of ["cancel", "reset", "send", "live"] as const) {
    const f = fixture();
    f.network.reject(new Error("offline"));
    await flush();
    if (action === "cancel") f.cancel();
    if (action === "reset") f.reset();
    if (action === "send") f.changeTurns([{ id: "new", role: "user", createdAt, text: "Sent" }]);
    if (action === "live") f.startLive();
    const owned = f.turns;
    f.durable.resolve(payload("Old"));
    await flush();
    assert.equal(f.turns, owned);
    assert.equal(f.paints, 0);
    assert.notEqual(f.state, "offline");
  }
});

test("404 is authoritative even with memory or durable history; it never waits for decryption", async () => {
  for (const memory of [null, payload("Memory")]) {
    const f = fixture({ memory });
    f.durable.resolve(payload("Durable"));
    await flush();
    f.network.reject(new ConversationLoadError("Gone", 404));
    await flush();
    assert.equal(f.state, "missing");
    assert.equal(f.turns.length, 0);
    assert.equal(f.activeLeafId, "");
  }
  const pending = fixture();
  pending.network.reject(new ConversationLoadError("Gone", 404));
  await flush();
  assert.equal(pending.state, "missing");
  pending.durable.resolve(payload("Late durable"));
  await flush();
  assert.equal(pending.turns.length, 0);
});

test("uncached network failure is error; invalid/missing success is missing; known context is loaded", async () => {
  const failed = fixture();
  failed.durable.resolve(null);
  failed.network.reject(new Error("offline"));
  await flush();
  assert.equal(failed.state, "error");
  for (const response of [null, { ok: false }, { ok: true }]) {
    const f = fixture();
    f.network.resolve(response);
    f.durable.resolve(null);
    await flush();
    assert.equal(f.state, "missing");
  }
  const known = fixture();
  const context = { task: null, tasks: [], github: [] };
  known.network.resolve({ ok: true, context });
  known.durable.resolve(null);
  await flush();
  assert.equal(known.state, "loaded");
  assert.equal(known.context, context);
  assert.equal(known.turns.length, 0);
});

test("flow-backed 404 uses cleaned flow transcript, with ownership checks after the flow request", async () => {
  const f = fixture({ flow: true });
  f.network.reject(new ConversationLoadError("Missing conversation", 404));
  await flush();
  assert.ok(f.events.includes("flow"));
  f.flowTranscript.resolve("@@step-start one\nFlow history\n@@step-done one");
  await flush();
  assert.equal(f.state, "loaded");
  assert.equal(f.fallback, "Flow history");
  assert.equal(f.turns.length, 0);
  f.durable.resolve(null);
  for (const action of ["cancel", "reset", "live"] as const) {
    const stale = fixture({ flow: true });
    stale.network.reject(new ConversationLoadError("Missing", 404));
    await flush();
    if (action === "cancel") stale.cancel();
    if (action === "reset") stale.reset();
    if (action === "live") stale.startLive();
    stale.flowTranscript.resolve("Stale flow");
    stale.durable.resolve(null);
    await flush();
    assert.equal(stale.fallback, null);
  }
});

test("live new-chat ownership survives missing history and network failure", async () => {
  for (const fails of [false, true]) {
    const f = fixture({ switched: false });
    f.keepLive();
    const owned = f.turns;
    if (fails) f.network.reject(new Error("offline")); else f.network.resolve(null);
    f.durable.resolve(null);
    await flush();
    assert.equal(f.turns, owned);
    assert.equal(f.state, "loaded");
  }
});

test("explicit reset fences history before React commits its cleared turn ref", async () => {
  const f = fixture({ memory: payload("Saved") });
  f.resetBeforeCommit();
  const cleared = f.turns;
  f.network.resolve(payload("Stale"));
  await flush();
  assert.equal(f.turns, cleared);
  assert.equal(f.writes.length, 0);
});

test("network refresh updates linked context even when the transcript revision is unchanged", async () => {
  const context = { task: null, tasks: [], github: [] };
  const nextContext = { ...context, github: [{ id: "issue", kind: "issue" as const, repo: "OpenCoven/coven-cave", title: "Linked work", url: "https://github.com/OpenCoven/coven-cave/issues/1", labels: [] }] };
  const f = fixture({ memory: { ...payload("Saved", "v1"), context } });
  const painted = f.turns;
  assert.equal(f.context, context);
  f.network.resolve({ ...payload("Saved", "v1"), context: nextContext });
  await flush();
  assert.equal(f.turns, painted);
  assert.equal(f.context, nextContext);
  assert.equal(f.state, "loaded");

  const live = fixture({ memory: { ...payload("Saved"), context } });
  live.startLive();
  live.network.resolve({ ...payload("Old response"), context: nextContext });
  await flush();
  assert.equal(live.context, context, "a pending history response cannot steal context from a live generation");
});
