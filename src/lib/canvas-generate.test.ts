// @ts-nocheck
import assert from "node:assert/strict";

import { parseSseFrame } from "./canvas-generate.ts";

// parseSseFrame is the pure half of the streaming generator — it must tolerate
// the exact frame shape /api/chat/send emits ("data: {json}") and shrug off
// anything malformed without throwing.

assert.deepEqual(
  parseSseFrame('data: {"kind":"assistant_chunk","text":"hi"}'),
  { kind: "assistant_chunk", text: "hi" },
  "a well-formed data frame parses to its event",
);

assert.deepEqual(
  parseSseFrame('data:{"kind":"done","sessionId":"s1"}'),
  { kind: "done", sessionId: "s1" },
  "no space after the colon is fine",
);

assert.equal(parseSseFrame(": keep-alive comment"), null, "SSE comments are ignored");
assert.equal(parseSseFrame("event: ping"), null, "non-data lines are ignored");
assert.equal(parseSseFrame("data: "), null, "empty data payload yields null");
assert.equal(parseSseFrame("data: {not json"), null, "malformed JSON yields null, not a throw");

console.log("canvas-generate.test.ts ✓");
