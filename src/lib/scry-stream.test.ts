import assert from "node:assert/strict";

import {
  SCRY_STAGES,
  decodeScryStream,
  readScryHarnessFrame,
  scryMurmur,
  scrySse,
  scryStageIndex,
  type ScryStreamEvent,
} from "./scry-stream.ts";

// ── Stage vocabulary ─────────────────────────────────────────────────────────

assert.equal(SCRY_STAGES[0], "picking", "a scry begins by choosing a harness");
assert.equal(
  SCRY_STAGES[SCRY_STAGES.length - 1],
  "done",
  "the rail must end on the terminal stage or the last pip never lights",
);
assert.ok(
  scryStageIndex("looking") < scryStageIndex("speaking"),
  "a harness cannot speak before it has been given the image",
);
assert.equal(new Set(SCRY_STAGES).size, SCRY_STAGES.length, "stage ids are unique");

// ── Harness frames ───────────────────────────────────────────────────────────
// These are verbatim lines from `coven run codex --stream-json` on a real scry;
// the stage sequence is only honest if it is read off frames of this shape.

assert.deepEqual(
  readScryHarnessFrame('{"type":"system","subtype":"init","session_id":"a"}'),
  { kind: "init" },
);
assert.deepEqual(
  readScryHarnessFrame('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}'),
  { kind: "prompt" },
);
assert.deepEqual(
  readScryHarnessFrame(
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I\'m inspecting the image."}]}}',
  ),
  { kind: "assistant", text: "I'm inspecting the image." },
);
assert.deepEqual(
  readScryHarnessFrame('{"type":"result","subtype":"success","duration_ms":12300}'),
  { kind: "result" },
);
assert.equal(
  readScryHarnessFrame("warning: harness `codex` does not support --speed fast"),
  null,
  "a plain CLI warning is not a frame and must not raise a stage",
);
assert.equal(readScryHarnessFrame('{"type":"assistant"'), null, "a half-line is never parsed");
assert.deepEqual(
  readScryHarnessFrame('{"type":"assistant","message":{"content":[{"type":"thinking"}]}}'),
  { kind: "assistant", text: "" },
  "an assistant frame with no text still marks that the harness has started",
);

// ── SSE wire ─────────────────────────────────────────────────────────────────

const wire = new TextDecoder().decode(
  scrySse({ kind: "stage", stage: "harness", detail: "Codex" }),
);
assert.equal(
  wire,
  'data: {"kind":"stage","stage":"harness","detail":"Codex"}\n\n',
  "the scry stream uses the same data-only SSE shape as the chat route",
);

// A body chunk splits wherever the network split it; a frame cut in half must
// survive into the next read rather than being dropped.
const first = decodeScryStream('data: {"kind":"stage","stage":"picking"}\n\ndata: {"kind":"sta');
assert.deepEqual(first.events, [{ kind: "stage", stage: "picking" }]);
const second = decodeScryStream('ge","stage":"looking"}\n\n', first.carry);
assert.deepEqual(second.events, [{ kind: "stage", stage: "looking" }]);
assert.equal(second.carry, "", "a completed frame leaves nothing behind");

const withHeartbeat = decodeScryStream(': hb\n\ndata: {"kind":"text","text":"hello"}\n\n');
assert.deepEqual(
  withHeartbeat.events,
  [{ kind: "text", text: "hello" }],
  "comment lines are transport, not events",
);

const withGarbage = decodeScryStream('data: {oops\n\ndata: {"kind":"error","code":"x","error":"y"}\n\n');
assert.deepEqual(
  withGarbage.events,
  [{ kind: "error", code: "x", error: "y" }],
  "one malformed frame must not lose the terminal event behind it",
);

// A whole real run, decoded one byte at a time — the harshest chunking there is.
const run: ScryStreamEvent[] = [
  { kind: "stage", stage: "picking" },
  { kind: "stage", stage: "harness", detail: "Codex" },
  { kind: "stage", stage: "staged" },
  { kind: "stage", stage: "looking", detail: "Codex" },
  { kind: "stage", stage: "speaking", detail: "Codex" },
  { kind: "text", text: "I’ll inspect the image and return only the requested JSON object." },
  { kind: "stage", stage: "done" },
  { kind: "done", harness: "codex", harnessLabel: "Codex", model: null, suggestions: {} },
];
const encoded = run
  .map((event) => new TextDecoder().decode(scrySse(event)))
  .join("");
let carry = "";
const seen: ScryStreamEvent[] = [];
for (const ch of encoded) {
  const decoded = decodeScryStream(ch, carry);
  carry = decoded.carry;
  seen.push(...decoded.events);
}
assert.deepEqual(seen, run, "byte-at-a-time decoding reproduces the run exactly");

// ── Murmur ───────────────────────────────────────────────────────────────────
// Only the harness's prose is shown to a person. Its JSON answer is the result,
// and the rite renders that as fields.

assert.equal(
  scryMurmur("I’ll inspect the image and return only the requested JSON object."),
  "I’ll inspect the image and return only the requested JSON object.",
);
assert.equal(
  scryMurmur('{"name":"Iron Halo","role":"Warden of Final Edges"}'),
  null,
  "the answer is not narration",
);
assert.equal(scryMurmur("   "), null);
assert.equal(scryMurmur("**Looking** at   it now"), "Looking at it now");
assert.equal(
  scryMurmur("x".repeat(400))?.length,
  160,
  "a runaway narration is truncated rather than pushing the slots off screen",
);

console.log("scry stream tests passed");
