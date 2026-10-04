import assert from "node:assert/strict";
import { normalizeRuntimeActivity, runtimeActivityForAdapter, runtimeActivityStatusLines, schemaSupportsToolCalls } from "./chat-runtime-activity.ts";

for (const state of ["supported", "partial", "unsupported", "unknown", "disabled"]) {
  const value = { schemaVersion: 1, path: "direct", tools: state, reasoning: state };
  assert.deepEqual(normalizeRuntimeActivity({ ...value, payload: "PRIVATE", authority: "forged" }), value);
  assert.equal(runtimeActivityStatusLines(value).length, 3);
  assert.doesNotMatch(runtimeActivityStatusLines(value).join(" "), /PRIVATE|forged/);
}
for (const value of [null, [], { schemaVersion: 99, path: "direct", tools: "supported", reasoning: "supported" },
  { schemaVersion: 1, path: "remote-user@example.com", tools: "supported", reasoning: "unknown" },
  { schemaVersion: 1, path: "ssh", tools: "executed", reasoning: "supported" },
  { schemaVersion: 1, path: "api", tools: "supported", reasoning: { toString: () => "supported" } }]) {
  assert.equal(normalizeRuntimeActivity(value), undefined);
  assert.deepEqual(runtimeActivityStatusLines(value), ["Activity support: not recorded"]);
}
assert.match(runtimeActivityStatusLines({ schemaVersion: 1, path: "ssh", tools: "unknown", reasoning: "unknown" }).join(" "), /SSH relay.*unverified/);
assert.deepEqual(runtimeActivityForAdapter("ssh"), { schemaVersion: 1, path: "ssh", tools: "unknown", reasoning: "unknown" });
assert.deepEqual(runtimeActivityForAdapter("coven", false, undefined, true), { schemaVersion: 1, path: "coven", tools: "partial", reasoning: "unknown" });
assert.deepEqual(runtimeActivityForAdapter("api", true, true), { schemaVersion: 1, path: "api", tools: "supported", reasoning: "supported" });
assert.deepEqual(runtimeActivityForAdapter("cli", false, false), { schemaVersion: 1, path: "cli", tools: "unsupported", reasoning: "unsupported" });
assert.equal(schemaSupportsToolCalls(undefined), false);
const textOnlySchema = { eventTypes: { toolStart: [], toolComplete: [], toolProgress: ["progress"], toolEnd: ["end"] } };
assert.equal(schemaSupportsToolCalls(textOnlySchema), false, "orphan progress/end frames cannot introduce a named tool call");
assert.equal(schemaSupportsToolCalls({ eventTypes: { toolStart: ["start"], toolComplete: [] } }), true);
assert.equal(schemaSupportsToolCalls({ eventTypes: { toolStart: [], toolComplete: ["tool_use"] } }), true);
console.log("chat-runtime-activity.test.ts: ok");

assert.equal(schemaSupportsToolCalls({ eventTypes: { toolStart: [], toolComplete: [], toolLifecycle: ["tool_call"] } }), true, "selected ACP lifecycle schemas can introduce a named call");
