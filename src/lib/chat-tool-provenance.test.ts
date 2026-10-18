import assert from "node:assert/strict";
import { ToolCallTracker, toPersistedTools } from "./chat-tool-events.ts";
import { normalizeToolActivity } from "./chat-activity.ts";
import { mergeToolObservation, settleToolObservations, normalizeToolStatus, isKnownToolOutcome, isToolActive, retainToolStatus, toolStatusLabel } from "./chat-tool-state.ts";

const runId = "22222222-3333-4444-8555-666666666666";
let now = 100;
const tracker = new ToolCallTracker(() => now, "", {
  runId, harness: "copilot", version: "1.0.70", protocol: "copilot-jsonl-v1",
});
const request = tracker.envelopeToolUse("native-call", "read");
assert.equal(request?.activity?.schemaVersion, 1, "server observations have a versioned contract");
now = 110;
const start = tracker.envelopeToolStart("native-call", "read");
now = 150;
const result = tracker.envelopeToolResult("native-call", "done", false);
assert.equal(request?.activity?.phase, "requested");
assert.equal(start?.activity?.phase, "running");
assert.equal(result?.activity?.phase, "ok");
assert.equal(result?.activity?.runId, runId);
assert.equal(result?.activity?.attemptId, request?.activity?.attemptId);
assert.equal(result?.activity?.firstObservedAt, 100);
assert.equal(result?.activity?.executionObservedAt, 110);
assert.equal(result?.activity?.terminalObservedAt, 150);
assert.deepEqual(result?.activity?.authority, { binding: "unavailable", approval: "unavailable", effect: "unavailable" });
assert.deepEqual(toPersistedTools(tracker.snapshot(), 0)?.[0]?.activity, result?.activity);
const retry = new ToolCallTracker(() => now, "retry-1:", { runId, harness: "copilot", version: "1.0.70", protocol: "copilot-jsonl-v1" });
assert.notEqual(retry.envelopeToolUse("native-call", "read")?.activity?.attemptId, request?.activity?.attemptId);
assert.ok(result?.activity);
const activity = result.activity;
for (const invalid of [
  { ...activity, schemaVersion: 2 },
  { ...activity, callId: "another-call" },
  { ...activity, phase: "running" },
  { ...activity, source: ["runtime-report"] },
  { ...activity, runId: "client-send-token" },
  { ...activity, attemptId: "missing" },
  { ...activity, updatedAt: 99 },
  ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "1"].map((sequence) => ({ ...activity, sequence })),
  { ...activity, executionObservedAt: 151 },
  { ...activity, terminalObservedAt: null },
  { ...activity, producer: { ...activity.producer, version: "unverified build" } },
  { ...activity, authority: { ...activity.authority, approval: "approved" } },
  { ...activity, authority: { ...activity.authority, receipt: "forged" } },
]) assert.equal(normalizeToolActivity(invalid, result.id, "ok"), undefined);
assert.deepEqual(normalizeToolActivity({ ...activity, receipt: "forged", producer: { ...activity.producer, privateData: "omitted" } }, result.id, "ok"), activity);
assert.equal(normalizeToolActivity(undefined, result.id, "ok"), undefined, "legacy tools gain no synthetic provenance");

const merged = mergeToolObservation(result, { ...start!, status: "error", output: "late conflicting result" });
assert.deepEqual(merged.activity, activity, "a late frame cannot rewrite the first terminal observation");
const locallySettled = settleToolObservations([start!])![0];
assert.equal(locallySettled.status, "unknown");
assert.equal(locallySettled.activity, undefined, "the client cannot manufacture provenance for a lost result");

const hooks = new ToolCallTracker(() => now, "", { runId, harness: "claude", version: null, protocol: null });
const hook = hooks.hookStart("Read", "safe.ts");
assert.equal(hook.activity?.source, "hook-report");
const unknown = hooks.settleUnfinished()[0];
assert.equal(unknown.activity?.source, "application");
assert.equal(unknown.activity?.phase, "unknown");
now = 140; // Observer clock moves backwards; timestamps still cannot regress.
const ended = hooks.hookEnd("Read", "done", false);
assert.equal(ended.activity?.source, "hook-report");
assert.equal(ended.activity?.terminalObservedAt, 150);
assert.equal(ended.activity?.executionObservedAt, null, "a result does not invent an execution-start time");
assert.notEqual(hooks.hookStart("Read", "safe.ts").id, ended.id, "a new hook request after completion remains a distinct call");
const rejected = new ToolCallTracker(() => now, "", { runId, harness: "codex", version: "0.145.0", protocol: "codex-jsonl-v1" });
rejected.envelopeToolUse("declined", "Bash");
const declined = rejected.envelopeToolResult("declined", "Declined", false, "rejected")!;
assert.equal(declined.activity?.phase, "rejected");
assert.equal(declined.activity?.executionObservedAt, null);
assert.equal(declined.activity?.terminalObservedAt, now);
assert.deepEqual(normalizeToolActivity(declined.activity, declined.id, "rejected"), declined.activity);
assert.deepEqual(mergeToolObservation(declined, { ...declined, status: "ok" }).activity, declined.activity);
assert.deepEqual(settleToolObservations([declined]), [declined]);
assert.deepEqual(toPersistedTools(rejected.snapshot(), 0)?.[0]?.activity, declined.activity);

// Requests and producer-confirmed outcomes must survive serialization without
// inventing permission, execution, or protected-effect evidence.
const lifecycle = [
  ["approval-requested", "Approval requested", false],
  ["cancel-requested", "Cancellation requested", false],
  ["cancelled", "Cancelled", true],
  ["policy-rejected", "Rejected by policy", true],
  ["user-rejected", "Rejected by user", true],
] as const;
for (const [status, label, terminal] of lifecycle) {
  assert.equal(normalizeToolStatus(status), status);
  assert.equal(toolStatusLabel(status), label);
  assert.equal(isKnownToolOutcome(status), terminal);
  assert.equal(isToolActive(status), !terminal);
  const observation = {
    ...activity, phase: status, executionObservedAt: null,
    terminalObservedAt: terminal ? activity.updatedAt : null,
  };
  assert.deepEqual(normalizeToolActivity(JSON.parse(JSON.stringify(observation)), result.id, status), observation);
  assert.equal(normalizeToolActivity({ ...observation, terminalObservedAt: terminal ? null : activity.updatedAt }, result.id, status), undefined);
  assert.deepEqual(observation.authority, { binding: "unavailable", approval: "unavailable", effect: "unavailable" });
  if (terminal) {
    assert.equal(retainToolStatus(status, "running"), status);
    assert.equal(retainToolStatus(status, "ok"), status);
    assert.equal(settleToolObservations([{ status }])![0].status, status);
  } else {
    assert.equal(settleToolObservations([{ status }])![0].status, "unknown");
  }
}
assert.equal(retainToolStatus("approval-requested", "requested"), "approval-requested");
assert.equal(retainToolStatus("running", "approval-requested"), "running");
assert.equal(retainToolStatus("cancel-requested", "running"), "cancel-requested");
assert.equal(retainToolStatus("cancel-requested", "approval-requested"), "cancel-requested");
assert.equal(retainToolStatus("cancel-requested", "ok"), "ok", "cancellation request can lose a race to completion");
assert.equal(retainToolStatus("cancel-requested", "cancelled"), "cancelled");
assert.equal(normalizeToolActivity({ ...activity, phase: "approval-requested", terminalObservedAt: null }, result.id, "approval-requested"), undefined, "approval request does not report execution");

for (const outcome of ["policy-rejected", "user-rejected", "cancelled"] as const) {
  const pending = new ToolCallTracker(() => now, "", { runId, harness: "fixture", version: null, protocol: null });
  assert.equal(pending.envelopeToolRequestState("missing", "cancel-requested"), null);
  pending.envelopeToolUse("pending", "read");
  const approval = pending.envelopeToolRequestState("pending", "approval-requested")!;
  assert.equal(approval.status, "approval-requested");
  assert.equal(approval.activity?.executionObservedAt, null);
  if (outcome === "cancelled") {
    assert.equal(pending.envelopeToolStart("pending", "read")?.status, "running");
    assert.equal(pending.envelopeToolRequestState("pending", "approval-requested"), null);
    const cancellation = pending.envelopeToolRequestState("pending", "cancel-requested")!;
    assert.equal(cancellation.status, "cancel-requested");
    assert.equal(cancellation.activity?.terminalObservedAt, null);
    assert.equal(pending.envelopeToolProgress("pending", undefined)?.status, "cancel-requested");
  }
  const terminal = pending.envelopeToolResult("pending", "safe result", false, outcome)!;
  assert.equal(terminal.status, outcome);
  assert.deepEqual(toPersistedTools(pending.snapshot(), 0)?.[0]?.activity, terminal.activity);
  assert.equal(pending.envelopeToolRequestState("pending", "cancel-requested"), null);
}
console.log("tool provenance: passed");
