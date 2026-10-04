import assert from "node:assert/strict";
import { normalizeRuntimeIdentity, runtimeIdentityForLaunch, withReportedRuntimeModel } from "./chat-runtime-identity.ts";

const launch = runtimeIdentityForLaunch("claude", "2.1.280");
assert.deepEqual(launch, { schemaVersion: 1, harness: "claude", version: "2.1.280", model: null });
assert.equal(runtimeIdentityForLaunch("claude", "Claude Code version >=2").version, null);
assert.equal(runtimeIdentityForLaunch("codex").model, null, "launch alone never establishes the model");
assert.deepEqual(withReportedRuntimeModel(launch, "claude-opus-5-5"), { ...launch, model: "claude-opus-5-5" });
for (const unknown of ["opus", "anthropic/opus", "auto", "unknown", "provider/unknown", "UNKNOWN", "claude-local", "not a model", "secret\nvalue", null, { model: "forged" }]) {
  assert.deepEqual(withReportedRuntimeModel(launch, unknown), launch);
}
assert.equal(withReportedRuntimeModel(launch, "bedrock/custom-deployment-v2").model, "bedrock/custom-deployment-v2");
assert.equal(launch.model, null, "identity updates never mutate earlier retained frames");
assert.equal(normalizeRuntimeIdentity({ ...launch, schemaVersion: 99 }, "claude"), undefined);
assert.equal(normalizeRuntimeIdentity(launch, "codex"), undefined);
assert.deepEqual(normalizeRuntimeIdentity({ ...launch, model: "claude-opus-5-5", payload: "private" }, "claude"), { ...launch, model: "claude-opus-5-5" });
const activity = { schemaVersion: 1 as const, path: "coven" as const, tools: "supported" as const, reasoning: "unknown" as const };
assert.deepEqual(normalizeRuntimeIdentity({ ...launch, activity }, "claude"), { ...launch, activity });
assert.deepEqual(normalizeRuntimeIdentity({ ...launch, activity: { ...activity, schemaVersion: 99 } }, "claude"), launch);
assert.deepEqual(withReportedRuntimeModel({ ...launch, activity }, "claude-opus-5-5").activity, activity);

const priorReport = withReportedRuntimeModel(launch, "claude-opus-5-5");
assert.equal(withReportedRuntimeModel(priorReport, null).model, null, "an explicit null report clears prior exact identity");
assert.equal(withReportedRuntimeModel(priorReport, "unknown").model, null, "an explicit unavailable report clears a prior exact model");
assert.equal(withReportedRuntimeModel(priorReport, "auto").model, null, "a later selection alias cannot retain stale exact evidence");
assert.equal(withReportedRuntimeModel(priorReport, undefined).model, priorReport.model, "an unrelated event without a model does not overwrite the report");
assert.equal(withReportedRuntimeModel(priorReport, "bedrock/unknown-project-v2").model, "bedrock/unknown-project-v2");
assert.equal(priorReport.model, "claude-opus-5-5", "invalidating a report cannot mutate retained metadata frames");
console.log("chat-runtime-identity.test.ts: ok");
