import assert from "node:assert/strict";
import { normalizeReasoningBlock, mergeReasoningBlock } from "./chat-reasoning-blocks.ts";
import { ReasoningBlockTracker, projectReasoningText } from "./server/chat-reasoning-projection.ts";
import { ToolCallTracker } from "./chat-tool-events.ts";

const context = { runId: "11111111-2222-4333-8444-555555555555", harness: "codex", version: "0.145.0", protocol: "codex-jsonl-v1" };
const attempt = "22222222-2222-4333-8444-555555555555";
let now = 100;
const tracker = new ReasoningBlockTracker(() => context, attempt, () => now);
const start = tracker.observe("r1", "running", "PRIVATE FRAGMENT");
assert.equal(start?.text, undefined, "even a producer summary cannot stream uninspected fragments");
now = 200;
const end = tracker.observe("r1", "complete", `Compare results. token=private-value Contact a.person@example.com +1 312-555-0199 123-45-6789`);
assert.equal(end?.phase, "complete");
assert.match(end!.text!, /Compare results/);
assert.doesNotMatch(JSON.stringify(end), /private-value|a.person@|312-555|123-45|PRIVATE/);
assert.equal(end?.observation.firstObservedAt, 100);
assert.equal(end?.observation.completedAt, 200);
assert.equal(tracker.observe("r1", "complete", "conflicting replay"), undefined);
assert.deepEqual(mergeReasoningBlock([end!], start!), [end]);
assert.deepEqual(normalizeReasoningBlock({ ...end, signature: "opaque", observation: { ...end!.observation, receipt: "forged" } }), end);
for (const invalid of [
  { ...end, schemaVersion: 2 }, { ...end, phase: "running" },
  { ...end, disclosure: "withheld" }, { ...end, observation: { ...end!.observation, binding: "verified" } },
  { ...end, observation: { ...end!.observation, attemptId: context.runId } },
  { ...end, observation: { ...end!.observation, completedAt: 99 } },
]) assert.equal(normalizeReasoningBlock(invalid), undefined);
assert.equal(projectReasoningText("unclassified", "legacy-unverified"), undefined);
assert.equal(projectReasoningText("x".repeat(70_000), "provider-summary"), undefined);
const opaque = tracker.observe("redacted", "unavailable");
const withheld = tracker.observe("provider-redacted", "unavailable", undefined, "provider-summary", "runtime-report", "provider-withheld");
assert.equal(withheld?.unavailableReason, "provider-withheld");
assert.equal(withheld?.text, undefined);
assert.equal(normalizeReasoningBlock({ ...withheld, unavailableReason: "future" }), undefined);
assert.equal(normalizeReasoningBlock({ ...withheld, observation: { ...withheld!.observation, source: "application" } }), undefined,
  "a local settlement cannot claim the provider withheld a summary");
assert.equal(opaque?.observation.source, "runtime-report", "provider omission remains distinct from a lost stream");
const pending = tracker.observe("r2", "running");
now = 190;
const unavailable = tracker.settle()[0];
assert.equal(unavailable.phase, "unavailable");
assert.equal(unavailable.observation.source, "application");
assert.equal(unavailable.text, undefined);
assert.equal(unavailable.observation.updatedAt, pending?.observation.updatedAt, "observed time cannot regress");
const retry = new ReasoningBlockTracker(() => context, "33333333-2222-4333-8444-555555555555", () => now);
assert.notEqual(retry.observe("r1", "complete", "Retry summary")?.id, end?.id);

// A clock can tie across every event. Ordering comes from one Cave-owned
// counter shared by both trackers and all attempts, not producer timestamps.
let sequence = 0;
const orderedContext = { ...context, nextSequence: () => sequence++ };
const orderedTools = new ToolCallTracker(() => 500, "", orderedContext);
const orderedReasoning = new ReasoningBlockTracker(() => orderedContext, orderedTools.attemptId, () => 500);
const first = orderedReasoning.observe("before", "running", undefined, "provider-summary", "runtime-report", undefined, 0)!;
const tool = orderedTools.envelopeToolUse("read", "read_file", "marker.txt", 8)!;
const second = orderedReasoning.observe("after", "complete", "Read complete.", "provider-summary", "runtime-report", undefined, 8)!;
assert.deepEqual([first.observation.sequence, tool.activity?.sequence, second.observation.sequence], [0, 1, 2]);
assert.equal(first.textOffset, 0);
assert.equal(second.textOffset, 8);
const updated = orderedReasoning.observe("before", "complete", "Inspect the file.", "provider-summary", "runtime-report", undefined, 99)!;
assert.equal(updated.observation.sequence, 0, "summary completion preserves first observation order");
assert.equal(updated.textOffset, 0, "summary completion cannot move its first text anchor");
assert.equal(orderedTools.envelopeToolStart("read", "read_file")?.activity?.sequence, 1);
assert.equal(orderedTools.envelopeToolResult("read", "done", false)?.activity?.sequence, 1);
assert.equal(sequence, 3, "updates and duplicates do not consume a new display position");
orderedReasoning.rebaseTextOffsets(8, 4);
assert.deepEqual(orderedReasoning.snapshot().map((block) => block.textOffset), [0, 12]);
const nextAttempt = new ReasoningBlockTracker(() => orderedContext, attempt, () => 500);
assert.equal(nextAttempt.observe("retry", "running")?.observation.sequence, 3);
for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "1"]) {
  assert.equal(normalizeReasoningBlock({ ...updated, textOffset: invalid }), undefined);
  assert.equal(normalizeReasoningBlock({ ...updated, observation: { ...updated.observation, sequence: invalid } }), undefined);
}
console.log("chat-reasoning-blocks: passed");
