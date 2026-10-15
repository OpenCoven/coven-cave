import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  addChatRunKeys,
  markChatRunProjectionSettled,
  markChatRunTransportSettled,
  registerChatRun,
  requestChatStop,
  resetChatStopRegistryForTests,
  unregisterChatRun,
} from "./chat-stop-registry.ts";

// Chat-run liveness reaches clients through the session surfaces, so visible
// run transitions publish `sessions` through the sessions-list invalidation
// (#5843, wired in #5838). A stop request or a transport settlement changes
// nothing a client lists, so neither publishes.
let seen: string[] = [];
beforeEach(() => {
  resetChatStopRegistryForTests();
  seen = [];
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged: (topic) => seen.push(topic),
  };
});
afterEach(() => {
  delete globalThis.__covenCaveEventPlanePublisher;
});

test("register, added keys, projection settlement and unregister publish sessions", () => {
  const handle = registerChatRun(["run-1"], () => {}, { runId: "run-1" });
  assert.deepEqual(seen, ["sessions"], "registration makes the run visible");
  addChatRunKeys(handle, ["session:run-1"]);
  assert.deepEqual(seen, ["sessions", "sessions"], "a newly announced conversation id");
  markChatRunProjectionSettled(handle);
  assert.deepEqual(seen, ["sessions", "sessions", "sessions"], "the run stops presenting as live");
  unregisterChatRun(handle);
  assert.equal(seen.length, 3, "after projection settlement, unregistering changes nothing visible");
});

test("a stop request and transport settlement publish nothing", () => {
  const handle = registerChatRun(["run-2"], () => {}, { runId: "run-2" });
  seen = [];
  requestChatStop("run-2");
  markChatRunTransportSettled(handle);
  addChatRunKeys(handle, ["run-2"]);
  assert.deepEqual(seen, [], "stop intent, settlement, and an already-known key change no listed state");
  unregisterChatRun(handle);
  assert.deepEqual(seen, ["sessions"], "unregistering a live projection does");
});
