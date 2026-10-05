import assert from "node:assert/strict";
import { ToolCallTracker, toPersistedTools, type ToolStreamEvent } from "./chat-tool-events.ts";
import { applyToolActions } from "./runtime-tool-adapter.ts";
import { copilotToolActions, parseCopilotChatEvent } from "./copilot-stream.ts";
import { mergeToolObservation, settleToolObservations, toolStatusLabel, type ToolStatus } from "./chat-tool-state.ts";
import { verificationEvidenceFromTool } from "./chat-tool-verification.ts";

let now = 10;
const calls = new ToolCallTracker(() => now);
assert.equal(calls.envelopeToolUse("one", "shell", '{"command":"pwd"}')?.status, "requested",
  "a model request is not an execution start");
now = 20;
assert.equal(calls.envelopeToolStart("one", "shell")?.status, "running",
  "an observed execution start advances the same call");
assert.equal(calls.snapshot().length, 1);
assert.equal(calls.envelopeToolStart("one", "shell"), null, "duplicate starts are suppressed");
now = 30;
assert.equal(calls.envelopeToolResult("one", "ok", false)?.status, "ok");
assert.equal(calls.hookStart("shell", '{"command":"pwd"}').status, "ok",
  "a delayed pre-hook cannot reopen a completed call");
assert.deepEqual(calls.settleUnfinished(), []);
assert.equal(calls.hookEnd("shell", "conflicting late result", true).status, "ok",
  "the first known result remains terminal across hook/envelope reordering");
assert.equal(calls.snapshot()[0]?.output, "ok");

const unknown = new ToolCallTracker(() => now);
unknown.envelopeToolUse("missing", "read");
assert.equal(unknown.settleUnfinished()[0]?.status, "unknown",
  "turn completion cannot establish a tool outcome");
assert.equal(unknown.snapshot()[0]?.status, "unknown");
assert.equal(unknown.envelopeToolUse("missing", "read"), null);
assert.equal(unknown.envelopeToolResult("missing", "late result", false)?.status, "ok",
  "a late actual result can resolve an unknown outcome");

const interrupted = new ToolCallTracker(() => now);
const interruptedStart = interrupted.hookStart("write");
assert.equal(interrupted.failOpenCalls()[0]?.status, "unknown",
  "transport failure cannot prove the tool failed or was cancelled");
const latePost = interrupted.hookEnd("write", "completed after transport loss", false);
assert.equal(latePost.id, interruptedStart.id, "a late post hook resolves the original unknown call");
assert.equal(latePost.status, "ok");
assert.equal(interrupted.snapshot().length, 1);
assert.equal(toPersistedTools([{ id: "a", name: "read", status: "running" }], 0)?.[0]?.status, "unknown");
assert.equal(toPersistedTools([{ id: "b", name: "read", status: "requested" }], 0)?.[0]?.status, "unknown");
assert.equal(toolStatusLabel("unknown"), "Outcome unknown");
const terminal = { status: "ok" as ToolStatus, output: "original", durationMs: 1 };
assert.deepEqual(mergeToolObservation(terminal, { status: "error", output: "replacement", durationMs: 2 }), {
  ...terminal, input: undefined,
});
assert.equal(mergeToolObservation({ status: "unknown" }, { status: "running" }).status, "unknown");
assert.equal(mergeToolObservation({ status: "running" }, { status: "requested" }).status, "running");
assert.deepEqual(settleToolObservations([{ status: "requested" }, { status: "running" }, { status: "ok" }, { status: "error" }])?.map((tool) => tool.status), ["unknown", "unknown", "ok", "error"]);
for (const status of ["requested", "unknown"] as const) {
  assert.equal(verificationEvidenceFromTool({ id: "verify", name: "bash", input: '{"command":"pnpm test"}', status }), null,
    "request/missing result cannot become a verified test execution");
}
const reusable = new ToolCallTracker(() => now);
const emitted: ToolStreamEvent[] = [];
const context = { push: (event: ToolStreamEvent) => emitted.push(event), textLen: () => 0 };
applyToolActions([{ op: "use", id: "adapter", name: "read" }], reusable, context);
const execution = parseCopilotChatEvent({ type: "tool.execution_start", data: { toolCallId: "adapter", toolName: "read" } });
assert.ok(execution);
applyToolActions(copilotToolActions(execution), reusable, context);
applyToolActions([{ op: "result", id: "adapter", output: "done", isError: false }], reusable, context);
assert.deepEqual(emitted.map((event) => event.status), ["requested", "running", "ok"],
  "the reusable adapter has the same lifecycle as direct route dispatch");
const rejected = new ToolCallTracker(() => now);
assert.equal(rejected.envelopeToolResult("denied", "Request declined", false, "rejected"), null);
rejected.envelopeToolUse("denied", "bash", '{"command":"pnpm test"}');
const denied = rejected.consumePendingEnvelopeResult("denied");
assert.equal(denied?.status, "rejected", "reordered rejection is not a failed execution");
assert.equal(rejected.envelopeToolStart("denied", "bash"), null);
assert.equal(rejected.envelopeToolResult("denied", "contradictory success", false), null);
assert.equal(rejected.hookStart("bash", '{"command":"pnpm test"}').status, "rejected");
assert.equal(rejected.hookEnd("bash", "contradictory hook failure", true).status, "rejected");
assert.equal(toPersistedTools(rejected.snapshot(), 0)?.[0]?.status, "rejected");
assert.equal(toolStatusLabel("rejected"), "Rejected");
const rejectedActions: ToolStreamEvent[] = [];
applyToolActions([{ op: "use", id: "declined", name: "shell" }, { op: "result", id: "declined", isError: false, outcome: "rejected" }], new ToolCallTracker(), { push: (event) => rejectedActions.push(event), textLen: () => 0 });
assert.deepEqual(rejectedActions.map((event) => event.status), ["requested", "rejected"]);
assert.equal(verificationEvidenceFromTool({ id: "denied", name: "bash", input: '{"command":"pnpm test"}', status: "rejected" }), null);
assert.equal(mergeToolObservation({ status: "rejected" }, { status: "ok" }).status, "rejected");
assert.equal(settleToolObservations([{ status: "rejected" }])?.[0]?.status, "rejected");
console.log("tool outcomes: passed");
