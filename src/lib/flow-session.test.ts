import assert from "node:assert/strict";
import { flowSessionCompletions, flowSessionReferenceFor, flowSessionReferences, isUnstartedFlowDiscussion, normalizeFlowSessionCompletions, normalizeFlowSessionReferences } from "./flow-session.ts";

assert.equal(flowSessionReferenceFor({}, "constructor"), undefined);
assert.equal(isUnstartedFlowDiscussion(null), false);
assert.equal(isUnstartedFlowDiscussion({}), false);
assert.equal(isUnstartedFlowDiscussion({ flowDiscussion: { flowId: "flow", runId: "run" } }), true);
assert.equal(isUnstartedFlowDiscussion({
  flowDiscussion: { flowId: "flow", runId: "run" }, harnessSessionId: "new-native-discussion",
}), false, "later human turns resume only the discussion's own native session");

assert.deepEqual(flowSessionReferences([
  null, [], { id: 1, flowId: "flow", sessionId: "chat" },
  { id: "run", flowId: "flow", sessionId: "../chat" },
]), {});
assert.deepEqual(flowSessionReferences([
  { id: "run", flowId: "flow", sessionId: "constructor", missionId: "mission", iteration: 2 },
]).constructor, { runId: "run", flowId: "flow", missionId: "mission", iteration: 2 });
const special = flowSessionReferences([{ id: "run", flowId: "flow", sessionId: "__proto__" }]);
assert.equal(Object.hasOwn(special, "__proto__"), true);
assert.equal(Object.getPrototypeOf(special), Object.prototype);
assert.deepEqual(flowSessionReferences([
  { id: "one", flowId: "flow", sessionId: "session" },
  { id: "two", flowId: "flow", sessionId: "session" },
]), {});
assert.deepEqual(flowSessionReferences([
  { id: "one", flowId: "flow", sessionId: "session", missionId: "a" },
  { id: "one", flowId: "flow", sessionId: "session", missionId: "b" },
]), {}, "conflicting parent identity is not certain ownership");
assert.deepEqual(normalizeFlowSessionReferences({ chat: true, other: { runId: "run" } }), {});
assert.deepEqual(normalizeFlowSessionReferences(["flow"]), {});
assert.deepEqual(normalizeFlowSessionReferences({ chat: { runId: "run", flowId: "flow", iteration: -1 } }), {});
assert.deepEqual(normalizeFlowSessionReferences({ chat: { runId: "run", flowId: "flow" } }),
  { chat: { runId: "run", flowId: "flow" } });
assert.deepEqual(normalizeFlowSessionCompletions({ live: false, settled: true, bad: "true" }),
  { live: false, settled: true });
assert.deepEqual(flowSessionCompletions([
  null, { id: "a", flowId: "flow", sessionId: "live", status: "running" },
  { id: "b", flowId: "flow", sessionId: "old", status: "failed" },
]), { live: false, old: true }, "old terminal history is not replayed as a new notification");
console.log("flow-session.test.ts OK");
