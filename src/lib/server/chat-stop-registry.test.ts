// @ts-nocheck
// Chat stop registry — the /api/chat/stop ↔ /api/chat/send contract that
// tells a deliberate Stop apart from a bare transport drop (cave-id5).
import assert from "node:assert/strict";

const { registerChatRun, unregisterChatRun, requestChatStop, addChatRunKeys, hasActiveChatRun } =
  await import("./chat-stop-registry.ts");

// Deliberate stop: kills through the registration and flags the handle.
{
  let kills = 0;
  const handle = registerChatRun(["run-1", "session-1"], () => {
    kills += 1;
  });
  assert.equal(handle.stopRequested, false, "fresh runs are not stop-flagged");
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
  unregisterChatRun(handle);
  addChatRunKeys(handle, ["conv-6"]);
  assert.equal(hasActiveChatRun("conv-6"), false, "no resurrection after unregister");
  assert.equal(requestChatStop("conv-6"), false, "the late key never registers");
}

console.log("chat-stop-registry.test.ts: ok");
