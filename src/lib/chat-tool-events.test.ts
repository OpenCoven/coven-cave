// @ts-nocheck
import assert from "node:assert/strict";
import { ToolCallTracker, toPersistedTools } from "./chat-tool-events.ts";

const tracker = new ToolCallTracker(() => 1_000);
assert.equal(tracker.envelopeToolResult("call_1", "late terminal output", false), null);
assert.equal(tracker.envelopeToolResult("call_1", "duplicate before start", true), null);
const started = tracker.envelopeToolUse("call_1", "bash", '{"command":"pwd"}', 4);
assert.deepEqual(started, { id: "call_1", name: "bash", input: '{"command":"pwd"}', status: "running" });
const settled = tracker.consumePendingEnvelopeResult("call_1");
assert.equal(settled?.id, "call_1");
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

console.log("chat-tool-events.test.ts: ok");
