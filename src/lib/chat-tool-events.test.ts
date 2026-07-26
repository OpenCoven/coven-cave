// @ts-nocheck
import assert from "node:assert/strict";
import { MAX_RECORDED_TOOL_EVENTS, MAX_SETTLED_ENVELOPE_IDS, MAX_SETTLED_RECONCILIATION_CALLS, ToolCallTracker, capLiveToolPayload, toPersistedTools } from "./chat-tool-events.ts";

const tracker = new ToolCallTracker(() => 1_000);
assert.equal(tracker.envelopeToolResult("call_1", "late terminal output", false), null);
assert.equal(tracker.envelopeToolResult("call_1", "duplicate before start", true), null);
const started = tracker.envelopeToolUse("call_1", "bash", '{"command":"pwd"}', 4);
assert.deepEqual(started, { id: "call_1", name: "bash", input: '{"command":"pwd"}', status: "running" });
const settled = tracker.consumePendingEnvelopeResult("call_1");
assert.equal(settled?.id, "call_1");
assert.equal(settled?.input, '{"command":"pwd"}');
assert.equal(settled?.status, "ok");
assert.equal(settled?.output, "late terminal output");
assert.equal(settled?.status, "ok", "duplicate results before their start do not replace the first terminal frame");
assert.equal(tracker.snapshot().length, 1, "reordered events reconcile to one persisted bubble");
assert.equal(tracker.envelopeToolUse("call_1", "bash"), null, "duplicate starts do not duplicate the persisted bubble");
assert.equal(tracker.envelopeToolResult("call_1", "duplicate", false), null, "duplicate results do not overwrite the settled bubble");
assert.deepEqual(
  toPersistedTools(tracker.snapshot(), 0),
  [{ id: "call_1", name: "bash", input: '{"command":"pwd"}', output: "late terminal output", status: "ok", durationMs: 0, textOffset: 4 }],
  "reconciled OpenCode calls persist their stable id and terminal output for reload/resume",
);

const progress = new ToolCallTracker(() => 1_000);
assert.equal(progress.envelopeToolProgress("progress_1", "queued"), null, "progress before a start never creates a nameless bubble");
assert.ok(progress.envelopeToolUse("progress_1", "read"));
assert.deepEqual(
  progress.consumePendingEnvelopeProgress("progress_1"),
  { id: "progress_1", name: "read", output: "queued", status: "running" },
  "reordered progress updates the later start under its stable id",
);
assert.deepEqual(
  progress.envelopeToolProgress("progress_1", "halfway"),
  { id: "progress_1", name: "read", output: "halfway", status: "running" },
  "progress after a start updates the same running bubble without settling it",
);
assert.deepEqual(
  progress.snapshot(),
  [{ id: "progress_1", name: "read", input: undefined, output: "halfway", status: "running" }],
  "a progress-only lifecycle remains explicitly running until a result arrives",
);
assert.deepEqual(
  toPersistedTools(progress.snapshot(), 0),
  [{ id: "progress_1", name: "read", output: "halfway\n[tool did not settle before the turn ended]", status: "error" }],
  "a progress-only lifecycle is recovered as a terminal error instead of persisting an infinite spinner",
);

const oversized = new ToolCallTracker(() => 1_000);
assert.equal(oversized.envelopeToolResult("call_large", "x".repeat(100_000), false), null);
const largeStart = oversized.envelopeToolUse("call_large", "read");
assert.ok(largeStart, "a bounded deferred result still reconciles once its start arrives");
const largeEnd = oversized.consumePendingEnvelopeResult("call_large");
assert.ok((largeEnd?.output.length ?? 0) <= 16_100, "reordered results are capped before tracker and SSE retention");
assert.ok(
  new TextEncoder().encode(capLiveToolPayload("😀".repeat(10_000), 16_000) ?? "").byteLength <= 16_000,
  "unicode tool payloads respect byte rather than UTF-16 code-unit caps",
);

const linkedHook = new ToolCallTracker(() => 1_000);
linkedHook.hookStart("read");
assert.equal(linkedHook.envelopeToolUse("hook-linked", "read", "x".repeat(100_000)), null);
const linkedHookInput = linkedHook.snapshot()[0]?.input;
assert.ok(
  new TextEncoder().encode(linkedHookInput ?? "").byteLength <= 8_000,
  "linking an OpenCode envelope to a hook call preserves the live input cap",
);

const terminalWindow = new ToolCallTracker(() => 1_000);
for (let index = 0; index <= MAX_SETTLED_ENVELOPE_IDS; index += 1) {
  const id = `settled-${index}`;
  assert.ok(terminalWindow.envelopeToolUse(id, "read"));
  assert.ok(terminalWindow.envelopeToolResult(id, "ok", false));
}
assert.equal(terminalWindow.envelopeToolUse(`settled-${MAX_SETTLED_ENVELOPE_IDS}`, "read"), null, "recent terminal ids still suppress retransmitted starts");
assert.ok(terminalWindow.envelopeToolUse("settled-0", "read"), "the bounded terminal-id window evicts only the oldest completed id");
terminalWindow.hookEnd("never-started", undefined, false);
assert.equal(
  terminalWindow.envelopeToolUse("after-empty-hook-end", "never-started"),
  null,
  "a delayed envelope links to the recent post-only hook instead of duplicating its bubble",
);

const recordedWindow = new ToolCallTracker(() => 1_000);
for (let index = 0; index <= MAX_RECORDED_TOOL_EVENTS; index += 1) {
  const id = `recorded-${index}`;
  assert.ok(recordedWindow.envelopeToolUse(id, "read"));
  assert.ok(recordedWindow.envelopeToolResult(id, "ok", false));
}
assert.equal(recordedWindow.snapshot().length, MAX_RECORDED_TOOL_EVENTS, "a long-running runtime cannot retain unbounded settled tool records");

const lateReconciliationWindow = new ToolCallTracker(() => 1_000);
for (let index = 0; index <= MAX_SETTLED_RECONCILIATION_CALLS; index += 1) {
  const name = `tool-${index}`;
  assert.ok(lateReconciliationWindow.envelopeToolUse(`reconcile-${index}`, name));
  assert.ok(lateReconciliationWindow.envelopeToolResult(`reconcile-${index}`, "ok", false));
}
const retainedLateEnvelopeCalls = Array.from((lateReconciliationWindow as any).settledEnvelopeCalls.values())
  .reduce((total: number, queue: unknown[]) => total + queue.length, 0);
assert.equal(
  retainedLateEnvelopeCalls,
  MAX_SETTLED_RECONCILIATION_CALLS,
  "completed envelope calls retained for late hooks stay globally bounded across distinct tool names",
);

console.log("chat-tool-events.test.ts: ok");
