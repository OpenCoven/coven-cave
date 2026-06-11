// @ts-nocheck
import assert from "node:assert/strict";
import {
  appendEvents,
  nextAfterSeq,
  shouldPollEvents,
  formatEventPayload,
  buildDebugBundle,
  debugFileName,
} from "./session-debug.ts";

const ev = (seq, kind = "tool_use") => ({
  seq,
  id: `e${seq}`,
  session_id: "s1",
  kind,
  payload_json: "{}",
  created_at: "2026-06-10T00:00:00Z",
});

// appendEvents: appends, dedupes by seq, keeps ascending order
assert.deepEqual(appendEvents([], [ev(1), ev(2)]).map((e) => e.seq), [1, 2]);
assert.deepEqual(
  appendEvents([ev(1), ev(2)], [ev(2), ev(3)]).map((e) => e.seq),
  [1, 2, 3],
  "overlapping seqs are deduped",
);
const same = [ev(1)];
assert.equal(appendEvents(same, [ev(1)]), same, "pure-duplicate append returns the same array");
assert.equal(appendEvents(same, []), same, "empty append returns the same array");
assert.deepEqual(
  appendEvents([ev(2)], [ev(1)]).map((e) => e.seq),
  [1, 2],
  "out-of-order incoming gets sorted",
);

// nextAfterSeq: cursor for the next ?afterSeq= fetch
assert.equal(nextAfterSeq([]), 0);
assert.equal(nextAfterSeq([ev(1), ev(7)]), 7);

// shouldPollEvents: only while running and visible
assert.equal(shouldPollEvents({ status: "running", visible: true }), true);
assert.equal(shouldPollEvents({ status: "running", visible: false }), false);
assert.equal(shouldPollEvents({ status: "completed", visible: true }), false);
assert.equal(shouldPollEvents({ status: null, visible: true }), false);

// formatEventPayload: pretty-prints JSON, passes through non-JSON untouched
assert.equal(formatEventPayload('{"a":1}'), '{\n  "a": 1\n}');
assert.equal(formatEventPayload("not json"), "not json");

// buildDebugBundle: shape + familiar narrowed to {id, harness, model}
const bundle = buildDebugBundle({
  session: { id: "s1", status: "completed" },
  familiar: { id: "f1", display_name: "Nova", role: "dev", harness: "claude", model: "opus" },
  turns: [{ id: "t1", role: "user", text: "hi", createdAt: "2026-06-10T00:00:00Z" }],
  events: [ev(1)],
});
assert.equal(bundle.session.id, "s1");
assert.deepEqual(bundle.familiar, { id: "f1", harness: "claude", model: "opus" });
assert.equal(bundle.turns.length, 1);
assert.equal(bundle.events.length, 1);
assert.equal(buildDebugBundle({ session: null, familiar: null, turns: [], events: [] }).familiar, null);

// debugFileName
assert.equal(debugFileName("s1"), "debug-s1.json");
assert.equal(debugFileName(null), "debug-session.json");

console.log("session-debug tests passed");
