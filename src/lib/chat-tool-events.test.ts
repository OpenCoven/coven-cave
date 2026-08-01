// @ts-nocheck
import assert from "node:assert/strict";
import {
  LIVE_TOOL_INPUT_CAP,
  LIVE_TOOL_OUTPUT_CAP,
  MAX_RECORDED_TOOL_EVENTS,
  MAX_SETTLED_ENVELOPE_IDS,
  MAX_SETTLED_RECONCILIATION_CALLS,
  ToolCallTracker,
  capLiveToolPayload,
  toolTextCorrection,
  toPersistedTools,
} from "./chat-tool-events.ts";

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
const linkedHookStart = linkedHook.hookStart("read");
const linkedHookUpdate = linkedHook.envelopeToolUse("hook-linked", "read", "x".repeat(100_000));
assert.equal(linkedHookUpdate?.id, linkedHookStart.id, "a late envelope updates the existing hook bubble instead of creating a second one");
assert.equal(linkedHookUpdate?.status, "running", "a late envelope input keeps its running hook bubble running");
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
assert.equal(
  terminalWindow.envelopeToolUse("settled-0", "read"),
  null,
  "a retransmitted start remains a no-op after the bounded terminal-id window evicts it, so it cannot reopen the persisted call",
);

const largeHookStart = new ToolCallTracker(() => 1_000);
const largeHookStartInput = "x".repeat(LIVE_TOOL_INPUT_CAP + 1);
assert.equal(
  largeHookStart.hookStart("read", largeHookStartInput).input,
  capLiveToolPayload(largeHookStartInput, LIVE_TOOL_INPUT_CAP),
  "hook starts must cap tool input before returning the live SSE event",
);
assert.equal(
  largeHookStart.hookEnd("read", "x".repeat(LIVE_TOOL_OUTPUT_CAP + 1), false).output,
  capLiveToolPayload("x".repeat(LIVE_TOOL_OUTPUT_CAP + 1), LIVE_TOOL_OUTPUT_CAP),
  "hook completions must cap tool output before returning the live SSE event",
);
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

const lateEnvelopeInput = new ToolCallTracker(() => 1_000);
const hookOnlyStart = lateEnvelopeInput.hookStart("Read");
const delayedInput = "x".repeat(LIVE_TOOL_INPUT_CAP + 1);
assert.deepEqual(
  lateEnvelopeInput.envelopeToolUse("late-input", "Read", delayedInput),
  {
    id: hookOnlyStart.id,
    name: "Read",
    input: capLiveToolPayload(delayedInput, LIVE_TOOL_INPUT_CAP),
    status: "running",
  },
  "a late envelope fills a hook-only live bubble with a bounded input update",
);
assert.equal(
  lateEnvelopeInput.snapshot()[0]?.input,
  capLiveToolPayload(delayedInput, LIVE_TOOL_INPUT_CAP),
  "late envelope input is bounded in persisted tracker state too",
);

const streamedInput = new ToolCallTracker(() => 1_000);
assert.ok(streamedInput.envelopeToolUse("streamed-input", "Read"));
assert.deepEqual(
  streamedInput.envelopeToolInput("streamed-input", delayedInput),
  {
    id: "streamed-input",
    name: "Read",
    input: capLiveToolPayload(delayedInput, LIVE_TOOL_INPUT_CAP),
    status: "running",
  },
  "streamed tool input updates are capped before they reach SSE",
);
assert.equal(
  streamedInput.snapshot()[0]?.input,
  capLiveToolPayload(delayedInput, LIVE_TOOL_INPUT_CAP),
  "streamed tool input updates are capped in tracker state too",
);
const completedHookInput = new ToolCallTracker(() => 1_000);
completedHookInput.hookStart("Read");
const hookCompletion = completedHookInput.hookEnd("Read", "done", false);
assert.deepEqual(
  completedHookInput.envelopeToolUse("late-completed-input", "Read", "{\"path\":\"README.md\"}"),
  {
    id: hookCompletion.id,
    name: "Read",
    input: "{\"path\":\"README.md\"}",
    status: "ok",
    durationMs: hookCompletion.durationMs,
  },
  "a late envelope fills a completed hook bubble without resetting its terminal status",
);

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

// Stdout can reorder every source: an envelope result may settle first, then a
// post hook can arrive before the matching pre hook. The delayed pre must
// attach to the already-terminal record rather than creating a second spinner
// that only fails at turn end.
const postBeforePre = new ToolCallTracker(() => 1_000);
assert.ok(postBeforePre.envelopeToolUse("post-before-pre", "Read", '{"path":"README.md"}'));
assert.equal(postBeforePre.envelopeToolResult("post-before-pre", "envelope output", false)?.status, "ok");
assert.equal(postBeforePre.hookEnd("Read", "hook output", false).id, "post-before-pre");
const delayedPre = postBeforePre.hookStart("Read", '{"path":"README.md"}');
assert.equal(delayedPre.id, "post-before-pre", "a pre hook delayed past its post updates the original envelope record");
assert.equal(delayedPre.status, "ok", "a delayed pre must not reopen a terminal tool bubble");
assert.deepEqual(postBeforePre.settleUnfinished(), [], "the post-before-pre permutation leaves no synthetic running call");
assert.deepEqual(postBeforePre.snapshot(), [{
  id: "post-before-pre",
  name: "Read",
  input: '{"path":"README.md"}',
  output: "hook output",
  status: "ok",
  durationMs: 0,
}]);


// Two large same-name inputs can share the entire display-capped prefix. Their
// full-input fingerprints must still keep reordered hook output on the matching
// native envelope id rather than falling back to FIFO.
const cappedPrefix = "x".repeat(LIVE_TOOL_INPUT_CAP);
const largeA = `${cappedPrefix}-first`;
const largeB = `${cappedPrefix}-second`;
const largeSameName = new ToolCallTracker(() => 1_000);
assert.ok(largeSameName.envelopeToolUse("large-a", "Read", largeA));
assert.ok(largeSameName.envelopeToolUse("large-b", "Read", largeB));
largeSameName.hookStart("Read", largeB);
largeSameName.hookStart("Read", largeA);
largeSameName.hookEnd("Read", "second output", false);
largeSameName.hookEnd("Read", "first output", false);
const largeSameNameRecords = new Map(largeSameName.snapshot().map((event) => [event.id, event]));
assert.equal(largeSameNameRecords.get("large-a")?.output, "first output");
assert.equal(largeSameNameRecords.get("large-b")?.output, "second output");

function applyTextCorrection(
  tracker: ToolCallTracker,
  previous: string,
  next: string,
) {
  const correction = toolTextCorrection(previous, next);
  if (correction) tracker.rebaseTextOffsets(correction.after, correction.delta);
  return correction;
}

const initialSnapshot = new ToolCallTracker(() => 1_000);
initialSnapshot.envelopeToolUse("initial-snapshot", "read", undefined, 0);
assert.equal(
  applyTextCorrection(initialSnapshot, "", "Initial full answer"),
  null,
  "an initial full snapshot does not rebase a tool that happened before text",
);
assert.equal(initialSnapshot.snapshot()[0]?.textOffset, 0);

const appendedSuffix = new ToolCallTracker(() => 1_000);
appendedSuffix.envelopeToolUse("append-suffix", "read", undefined, 5);
assert.deepEqual(
  applyTextCorrection(appendedSuffix, "Hello", "Hello world"),
  { after: 5, delta: 6 },
  "an appended suffix corrects offsets from the old text end",
);
assert.equal(appendedSuffix.snapshot()[0]?.textOffset, 11);

const commonPrefix = new ToolCallTracker(() => 1_000);
commonPrefix.envelopeToolUse("before-prefix", "read", undefined, 4);
commonPrefix.envelopeToolUse("after-prefix", "write", undefined, 10);
assert.deepEqual(
  applyTextCorrection(commonPrefix, "prefix old", "prefix new answer"),
  { after: 7, delta: 7 },
  "a divergent correction starts at the longest common prefix",
);
assert.deepEqual(
  commonPrefix.snapshot().map((event) => event.textOffset),
  [4, 17],
  "tools before the correction boundary stay fixed while later tools shift",
);

const shortenedReplacement = new ToolCallTracker(() => 1_000);
shortenedReplacement.envelopeToolUse("before-shortening", "read", undefined, 6);
shortenedReplacement.envelopeToolUse("after-shortening", "write", undefined, 15);
assert.deepEqual(
  applyTextCorrection(shortenedReplacement, "prefix long tail", "prefix x"),
  { after: 7, delta: -8 },
  "a shorter replacement reports the actual correction boundary and length delta",
);
assert.deepEqual(
  shortenedReplacement.snapshot().map((event) => event.textOffset),
  [6, 7],
  "shortening shifts only tools at or after the corrected suffix",
);

const substantialShortening = new ToolCallTracker(() => 1_000);
substantialShortening.envelopeToolUse("before-boundary", "read", undefined, 6);
substantialShortening.envelopeToolUse("at-boundary", "write", undefined, 7);
substantialShortening.envelopeToolUse("after-boundary", "bash", undefined, 12);
substantialShortening.rebaseTextOffsets(7, -100);
assert.deepEqual(
  substantialShortening.snapshot().map((event) => [event.id, event.textOffset]),
  [
    ["before-boundary", 6],
    ["at-boundary", 7],
    ["after-boundary", 7],
  ],
  "substantial shortening keeps prefix tools fixed, clamps corrected-suffix tools at the boundary, and preserves insertion order",
);

const duplicateFinal = new ToolCallTracker(() => 1_000);
duplicateFinal.envelopeToolUse("duplicate-final", "read", undefined, 4);
assert.equal(
  applyTextCorrection(duplicateFinal, "same text", "same text"),
  null,
  "an identical final snapshot is a no-op",
);
assert.equal(duplicateFinal.snapshot()[0]?.textOffset, 4);

console.log("chat-tool-events.test.ts: ok");
