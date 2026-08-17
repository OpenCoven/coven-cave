// @ts-nocheck
// Chat stop registry — the /api/chat/stop ↔ /api/chat/send contract that
// tells a deliberate Stop apart from a bare transport drop (cave-id5).
import assert from "node:assert/strict";

const {
  registerChatRun,
  unregisterChatRun,
  requestChatStop,
  requestOrQueueChatStop,
  addChatRunKeys,
  hasActiveChatRun,
  markChatRunTransportSettled,
  markChatRunProjectionSettled,
  pendingChatStopCountForTests,
  settledChatRunCountForTests,
  resetChatStopRegistryForTests,
  MAX_PENDING_CHAT_STOPS,
  MAX_SETTLED_CHAT_RUNS,
  PENDING_CHAT_STOP_TTL_MS,
  SETTLED_CHAT_RUN_TTL_MS,
} =
  await import("./chat-stop-registry.ts");

resetChatStopRegistryForTests();

// Deliberate stop: kills through the registration and flags the handle.
{
  let kills = 0;
  const handle = registerChatRun(["run-1", "session-1"], () => {
    kills += 1;
  });
  assert.equal(handle.stopRequested, false, "fresh runs are not stop-flagged");
  assert.equal(handle.runId, null, "aliases do not become an implicit runId");
  assert.equal(handle.acceptingStop, true, "fresh runs accept Stop");
  assert.equal(handle.projectionActive, true, "fresh runs project as live");
  assert.equal(requestChatStop("run-1"), true, "stop resolves by runId");
  assert.equal(kills, 1, "stop SIGTERMs through the registered kill");
  assert.equal(handle.stopRequested, true, "the handle records the deliberate stop");
  assert.equal(requestChatStop("session-1"), true, "stop also resolves by session key");
  assert.equal(kills, 2, "kill is safe to invoke repeatedly");
  unregisterChatRun(handle);
}

// Nothing in flight → stopped: false (an already-finished run is not an error).
assert.equal(requestChatStop("run-1"), false, "unregistered keys report nothing to stop");
assert.equal(requestChatStop("session-1"), false, "unregister drops every key");

// Once a run has definitively finished, late stops must be ignored even before
// the async persistence/finalization path unregisters it.
{
  let kills = 0;
  const handle = registerChatRun(["run-settled", "session-settled"], () => {
    kills += 1;
  });
  assert.equal(hasActiveChatRun("run-settled"), true, "fresh unsettled run is active");
  markChatRunTransportSettled(handle);
  assert.equal(handle.acceptingStop, false, "transport settlement closes the Stop window");
  assert.equal(handle.projectionActive, true, "projection stays live through persistence");
  assert.equal(hasActiveChatRun("run-settled"), true, "transport-settled runs remain active until projection cleanup");
  assert.equal(requestChatStop("run-settled"), false, "late stops are ignored once transport is settled");
  assert.equal(requestChatStop("session-settled"), false, "every transport-settled key becomes a no-op");
  assert.equal(handle.stopRequested, false, "late stop must not retroactively mark the run cancelled");
  assert.equal(kills, 0, "late stop must not re-kill an already settled run");
  markChatRunProjectionSettled(handle);
  assert.equal(handle.projectionActive, false, "projection settlement drops liveness before unregister");
  assert.equal(hasActiveChatRun("run-settled"), false, "projection-settled runs no longer count as active");
  unregisterChatRun(handle);
}

// A real stop that lands before settlement survives the later settle call and
// remains the outcome the send route should observe.
{
  let kills = 0;
  const handle = registerChatRun(["run-cancel-first"], () => {
    kills += 1;
  });
  assert.equal(requestChatStop("run-cancel-first"), true, "pre-settlement stop still lands");
  markChatRunTransportSettled(handle);
  assert.equal(handle.stopRequested, true, "settlement must preserve an earlier stop");
  assert.equal(handle.acceptingStop, false, "the handle still stops accepting Stop");
  assert.equal(kills, 1, "the registered kill only fires for the pre-settlement stop");
  unregisterChatRun(handle);
}

// Null/empty keys are skipped — a brand-new chat has no session id yet.
{
  const handle = registerChatRun([null, undefined, "", "run-2"], () => {});
  assert.deepEqual(handle.keys, ["run-2"], "only truthy keys register");
  unregisterChatRun(handle);
}

// A follow-up turn re-registers the same conversation key; the finished older
// run's cleanup must not evict the newer registration.
{
  const first = registerChatRun(["session-3"], () => {});
  const second = registerChatRun(["session-3"], () => {});
  unregisterChatRun(first);
  assert.equal(
    requestChatStop("session-3"),
    true,
    "newer registration survives the older run's cleanup",
  );
  assert.equal(second.stopRequested, true, "the stop lands on the newer run");
  unregisterChatRun(second);
}

// A throwing kill doesn't break the stop path (child already exited).
{
  const handle = registerChatRun(["run-4"], () => {
    throw new Error("ESRCH");
  });
  assert.equal(requestChatStop("run-4"), true, "stop succeeds when the child is already gone");
  assert.equal(handle.stopRequested, true, "the cancel flag still lands");
  unregisterChatRun(handle);
}

// cave-0g2x: a new chat registers with only the client runId — the harness
// mints the conversation id mid-stream, and announceSession late-keys it so
// Stop and the sessions-list liveness probe can reach the run by that id.
{
  let kills = 0;
  const handle = registerChatRun(["run-5", null], () => {
    kills += 1;
  });
  assert.equal(hasActiveChatRun("conv-5"), false, "the announced id is unknown before late-keying");
  addChatRunKeys(handle, ["conv-5", null, undefined, "run-5"]);
  assert.deepEqual(handle.keys, ["run-5", "conv-5"], "late keys skip falsy and duplicate entries");
  assert.equal(hasActiveChatRun("conv-5"), true, "the run is live under the announced id");
  assert.equal(requestChatStop("conv-5"), true, "stop resolves by the late-added conversation id");
  assert.equal(kills, 1, "the late key kills the same run");
  unregisterChatRun(handle);
  assert.equal(hasActiveChatRun("conv-5"), false, "unregister drops late-added keys too");
  assert.equal(hasActiveChatRun("run-5"), false, "…and the original key");
}

// Late-keying a settled run is a no-op — the stream finished before the
// announce callback ran.
{
  const handle = registerChatRun(["run-6"], () => {});
  markChatRunTransportSettled(handle);
  unregisterChatRun(handle);
  addChatRunKeys(handle, ["conv-6"]);
  assert.equal(hasActiveChatRun("conv-6"), false, "no resurrection after unregister");
  assert.equal(requestChatStop("conv-6"), false, "the late key never registers");
}

// A Stop can beat async send setup. The run-scoped intent is consumed exactly
// once after registration, even when teardown sends the same request twice.
{
  const now = 10_000;
  let kills = 0;
  resetChatStopRegistryForTests({ now: () => now });
  assert.equal(requestOrQueueChatStop("early-run"), "queued");
  assert.equal(requestOrQueueChatStop("early-run"), "queued");
  assert.equal(pendingChatStopCountForTests(), 1, "duplicate early Stops coalesce by runId");
  const handle = registerChatRun(["early-run", "shared-session"], () => {
    kills += 1;
  }, { runId: "early-run" });
  assert.equal(handle.runId, "early-run", "the explicit runId is retained separately");
  assert.equal(handle.stopRequested, true, "registration consumes the pending intent");
  assert.equal(kills, 1, "one pending intent invokes the safe kill exactly once");
  assert.equal(pendingChatStopCountForTests(), 0, "consumed intents do not leak");
  unregisterChatRun(handle);
}

// Pending runId intents survive setup delays longer than the route's ten-minute
// detach window, then expire at the explicit fifteen-minute maximum.
{
  let now = 20_000;
  let kills = 0;
  resetChatStopRegistryForTests({ now: () => now });
  assert.equal(requestOrQueueChatStop("slow-setup-run"), "queued");
  now += 10 * 60_000 + 1;
  assert.equal(pendingChatStopCountForTests(), 1, "intent survives beyond ten minutes");
  const slowSetup = registerChatRun(["slow-setup-run"], () => {
    kills += 1;
  }, { runId: "slow-setup-run" });
  assert.equal(slowSetup.stopRequested, true, "the retained pending intent cancels on registration");
  assert.equal(kills, 1, "the delayed registration consumes the intent exactly once");
  assert.equal(pendingChatStopCountForTests(), 0, "consumed intent state does not leak");
  unregisterChatRun(slowSetup);

  assert.equal(requestOrQueueChatStop("count-expiry-run"), "queued");
  now += PENDING_CHAT_STOP_TTL_MS;
  assert.equal(pendingChatStopCountForTests(), 0, "test counts prune intents at the TTL");

  assert.equal(requestOrQueueChatStop("register-expiry-run"), "queued");
  now += PENDING_CHAT_STOP_TTL_MS;
  const expiredSetup = registerChatRun(["register-expiry-run"], () => {
    kills += 1;
  }, { runId: "register-expiry-run" });
  assert.equal(expiredSetup.stopRequested, false, "registration prunes rather than consuming an expired intent");
  assert.equal(kills, 1, "expired intent never invokes the kill");
  unregisterChatRun(expiredSetup);
}

// Capacity remains strict without revoking any intent already acknowledged as
// queued. A duplicate remains idempotently accepted, the unexpired 257th intent
// is rejected, and abandoned capacity recovers after expiry.
{
  let now = 25_000;
  resetChatStopRegistryForTests({ now: () => now });
  for (let index = 0; index < MAX_PENDING_CHAT_STOPS; index += 1) {
    assert.equal(
      requestOrQueueChatStop(`bounded-${index}`),
      "queued",
      `intent ${index} is accepted`,
    );
  }
  assert.equal(requestOrQueueChatStop("bounded-0"), "queued", "a duplicate remains accepted");
  assert.equal(requestOrQueueChatStop("bounded-overflow"), "full");
  assert.equal(
    pendingChatStopCountForTests(),
    MAX_PENDING_CHAT_STOPS,
    "rejecting overflow neither inserts nor evicts",
  );

  let oldestKills = 0;
  const oldest = registerChatRun(["bounded-0"], () => {
    oldestKills += 1;
  }, { runId: "bounded-0" });
  assert.equal(oldest.stopRequested, true, "the oldest acknowledged intent was not evicted");
  assert.equal(oldestKills, 1);
  unregisterChatRun(oldest);

  now += PENDING_CHAT_STOP_TTL_MS;
  assert.equal(
    requestOrQueueChatStop("bounded-overflow"),
    "queued",
    "a request prunes expired entries and recovers capacity",
  );
  assert.equal(pendingChatStopCountForTests(), 1);

  resetChatStopRegistryForTests();
  assert.equal(pendingChatStopCountForTests(), 0, "test reset clears bounded pending intents");
}

// Run-scoped Stop ignores the alias namespace even when a later alias
// registration shadows the same string. Only the explicit runId owner dies.
{
  let aliasOwnerKills = 0;
  let runOwnerKills = 0;
  resetChatStopRegistryForTests();
  const runOwner = registerChatRun(
    ["collision-run-b", "collision-session-b"],
    () => {
      runOwnerKills += 1;
    },
    { runId: "collision-run-b" },
  );
  const aliasRun = registerChatRun(
    ["collision-run-a", "collision-run-b"],
    () => {
      aliasOwnerKills += 1;
    },
    { runId: "collision-run-a" },
  );
  assert.equal(requestOrQueueChatStop("collision-run-b"), "stopped");
  assert.equal(runOwner.stopRequested, true, "the explicit runId owner receives Stop");
  assert.equal(runOwnerKills, 1);
  assert.equal(aliasRun.stopRequested, false, "the colliding session alias owner is untouched");
  assert.equal(aliasOwnerKills, 0);
  unregisterChatRun(aliasRun);
  unregisterChatRun(runOwner);
}

// If B has not registered yet, A.sessionAlias === B.runId still queues only B.
// A's later settlement records only A.runId and cannot consume or tombstone B.
{
  let aliasOwnerKills = 0;
  let intendedKills = 0;
  resetChatStopRegistryForTests();
  const aliasRun = registerChatRun(
    ["unregistered-run-a", "future-run-b"],
    () => {
      aliasOwnerKills += 1;
    },
    { runId: "unregistered-run-a" },
  );
  assert.equal(requestOrQueueChatStop("future-run-b"), "queued");
  assert.equal(aliasRun.stopRequested, false, "the alias owner does not receive B's early Stop");
  assert.equal(aliasOwnerKills, 0);
  markChatRunTransportSettled(aliasRun);
  unregisterChatRun(aliasRun);
  assert.equal(
    pendingChatStopCountForTests(),
    1,
    "alias settlement and unregister preserve the intended runId intent",
  );
  assert.equal(settledChatRunCountForTests(), 1, "only A's explicit runId is tombstoned");
  assert.equal(
    requestOrQueueChatStop("future-run-b"),
    "queued",
    "A's tombstone cannot make B appear settled",
  );

  const intendedRun = registerChatRun(
    ["future-run-b"],
    () => {
      intendedKills += 1;
    },
    { runId: "future-run-b" },
  );
  assert.equal(intendedRun.runId, "future-run-b");
  assert.equal(intendedRun.stopRequested, true, "the intended run consumes its exact runId intent");
  assert.equal(intendedKills, 1, "only the intended run is killed");
  assert.equal(pendingChatStopCountForTests(), 0);
  unregisterChatRun(intendedRun);
}

// Cleanup and settlement from a replaced runId owner are identity-guarded, just
// like the alias map: an older handle cannot evict or tombstone the newer run.
{
  let newerKills = 0;
  resetChatStopRegistryForTests();
  const older = registerChatRun(["older-run-session"], () => {}, {
    runId: "reused-explicit-run",
  });
  const newer = registerChatRun(["newer-run-session"], () => {
    newerKills += 1;
  }, {
    runId: "reused-explicit-run",
  });
  markChatRunTransportSettled(older);
  unregisterChatRun(older);
  assert.equal(settledChatRunCountForTests(), 0, "the replaced owner cannot write a tombstone");
  assert.equal(requestOrQueueChatStop("reused-explicit-run"), "stopped");
  assert.equal(newer.stopRequested, true);
  assert.equal(newerKills, 1, "the newer explicit runId owner survives old cleanup");
  unregisterChatRun(newer);
}

// A live but transport-settled run keeps the existing late-stop behavior: it
// is neither killed nor replaced with a fresh pending intent.
{
  let kills = 0;
  resetChatStopRegistryForTests();
  const settled = registerChatRun(["already-settled"], () => {
    kills += 1;
  }, { runId: "already-settled" });
  markChatRunTransportSettled(settled);
  assert.equal(requestOrQueueChatStop("already-settled"), "settled");
  assert.equal(settled.stopRequested, false);
  assert.equal(kills, 0);
  assert.equal(pendingChatStopCountForTests(), 0);
  unregisterChatRun(settled);
  assert.equal(
    requestOrQueueChatStop("already-settled"),
    "settled",
    "the tombstone survives unregister",
  );
  assert.equal(pendingChatStopCountForTests(), 0, "a late settled Stop is never queued");
  assert.equal(settledChatRunCountForTests(), 1);
}

// Tombstones expire so an identifier can eventually describe a genuinely new
// run, and deterministic oldest-first eviction bounds abandoned settled keys.
{
  let now = 30_000;
  resetChatStopRegistryForTests({ now: () => now });
  const expired = registerChatRun(["expired-settled"], () => {}, {
    runId: "expired-settled",
  });
  markChatRunTransportSettled(expired);
  unregisterChatRun(expired);
  now += SETTLED_CHAT_RUN_TTL_MS;
  assert.equal(
    requestOrQueueChatStop("expired-settled"),
    "queued",
    "an id is unseen again at the tombstone TTL boundary",
  );
  assert.equal(settledChatRunCountForTests(), 0, "expired tombstones are pruned");
  assert.equal(pendingChatStopCountForTests(), 1, "the new early intent can queue");

  resetChatStopRegistryForTests({ now: () => now });
  for (let index = 0; index < MAX_SETTLED_CHAT_RUNS + 20; index += 1) {
    const runId = `settled-bounded-${index}`;
    const handle = registerChatRun([runId], () => {}, { runId });
    markChatRunTransportSettled(handle);
    unregisterChatRun(handle);
  }
  assert.equal(
    settledChatRunCountForTests(),
    MAX_SETTLED_CHAT_RUNS,
    "settled tombstone storage remains bounded",
  );
  assert.equal(pendingChatStopCountForTests(), 0, "settlement leaves no pending intent leak");
  resetChatStopRegistryForTests();
  assert.equal(settledChatRunCountForTests(), 0, "test reset clears tombstones");
}

resetChatStopRegistryForTests();
console.log("chat-stop-registry.test.ts: ok");
