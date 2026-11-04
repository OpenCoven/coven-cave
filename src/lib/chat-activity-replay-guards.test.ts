import assert from "node:assert/strict";
import { ToolCallTracker, toPersistedTools } from "./chat-tool-events.ts";
import { normalizeToolActivity } from "./chat-activity.ts";
import { settleToolObservations, type ToolOutcome } from "./chat-tool-state.ts";

// Golden-10 (#6059) negative guards. No authoritative approval producer exists
// for runtime activity, so stale or replayed approvals must never be admitted
// as authority and must never revive a settled call. This pins the display
// fold only; it is not the gate, which belongs to the producer (coven#857).

const runId = "33333333-4444-4555-8666-777777777777";
const context = { runId, harness: "fixture", version: null, protocol: null };
let now = 100;

const base = new ToolCallTracker(() => now, "", context);
base.envelopeToolUse("call", "write");
now = 110;
base.envelopeToolStart("call", "write");
now = 120;
const activity = base.envelopeToolResult("call", "done", false)!.activity!;
assert.equal(normalizeToolActivity(activity, activity.callId, "ok")?.callId, activity.callId);

// Replay identity is producer evidence; a client or transcript cannot supply it.
for (const [key, value] of [
  ["decisionId", "decision-1"],
  ["actionDigest", "sha256:0000"],
  ["revisionDigest", "sha256:1111"],
  ["expiresAt", 4_102_444_800_000],
  ["idempotencyKey", "submit-1"],
  ["receipt", "receipt-1"],
] as const) {
  assert.equal(normalizeToolActivity({ ...activity, authority: { ...activity.authority, [key]: value } }, activity.callId, "ok"), undefined,
    `authority.${key} is not accepted without a producer`);
  assert.deepEqual(normalizeToolActivity({ ...activity, [key]: value }, activity.callId, "ok")?.authority,
    { binding: "unavailable", approval: "unavailable", effect: "unavailable" }, `top-level ${key} grants nothing`);
  assert.equal(key in normalizeToolActivity({ ...activity, [key]: value }, activity.callId, "ok")!, false, `top-level ${key} is dropped`);
}
for (const approval of ["denied", "revoked", "expired", "consumed", "granted", "pending"]) {
  assert.equal(normalizeToolActivity({ ...activity, authority: { ...activity.authority, approval } }, activity.callId, "ok"), undefined,
    `approval "${approval}" is not runtime-activity authority`);
}

// Denied or revoked approval: a replayed approval request, start, or result
// cannot reopen the call or replace its first outcome, live or after reload.
for (const outcome of ["user-rejected", "policy-rejected", "cancelled"] satisfies ToolOutcome[]) {
  const calls = new ToolCallTracker(() => now, `${outcome}:`, context);
  calls.envelopeToolUse("pending", "write", '{"path":"/tmp/a"}');
  assert.equal(calls.envelopeToolRequestState("pending", "approval-requested")?.status, "approval-requested");
  const denied = calls.envelopeToolResult("pending", "not admitted", true, outcome)!;
  assert.equal(denied.status, outcome);
  assert.equal(denied.activity?.executionObservedAt, null, `${outcome} before execution reports no start`);
  assert.equal(calls.envelopeToolRequestState("pending", "approval-requested"), null, "a replayed approval cannot reopen");
  assert.equal(calls.envelopeToolStart("pending", "write"), null, "a replayed start cannot run a rejected call");
  assert.equal(calls.envelopeToolUse("pending", "write"), null, "a replayed request cannot add a row");
  assert.equal(calls.envelopeToolResult("pending", "second effect", false, "ok"), null, "a second result is not admitted");
  const persisted = toPersistedTools(calls.snapshot(), 0)!;
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].status, outcome);
  assert.equal(persisted[0].output, "not admitted");
  assert.deepEqual(persisted[0].activity, denied.activity);
  assert.equal(settleToolObservations(persisted)![0].status, outcome, "reload keeps the rejection");
}

// A repeated approval request (double submission) updates one row, not two.
const doubled = new ToolCallTracker(() => now, "double:", context);
doubled.envelopeToolUse("pending", "write");
doubled.envelopeToolRequestState("pending", "approval-requested");
doubled.envelopeToolRequestState("pending", "approval-requested");
assert.equal(doubled.snapshot().length, 1);
assert.equal(doubled.snapshot()[0].status, "approval-requested");

// An approval that expires without a producer outcome is unknown, not success.
const expired = new ToolCallTracker(() => now, "expired:", context);
expired.envelopeToolUse("pending", "write");
expired.envelopeToolRequestState("pending", "approval-requested");
assert.equal(expired.settleUnfinished()[0]?.status, "unknown");
assert.equal(expired.envelopeToolStart("pending", "write"), null, "a stale start cannot revive an expired request");
assert.equal(settleToolObservations([{ status: "approval-requested" as const }])![0].status, "unknown");

console.log("chat-activity replay guards: passed");
