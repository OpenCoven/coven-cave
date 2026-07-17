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
assert.equal(
  formatEventPayload('{"data":"\\u001b[31mError\\u001b[39m\\r\\nWorkspace: /tmp/project\\r\\n"}'),
  "Error\nWorkspace: /tmp/project",
  "output event data should be decoded, ANSI-stripped, and line-normalized",
);
assert.ok(
  !formatEventPayload('{"data":"\\u001b[31mError\\u001b[39m"}').includes("\\u001b"),
  "output event display should not expose JSON-escaped ANSI sequences",
);

// buildDebugBundle: shape + familiar narrowed to {id, harness, model}
const env = { appVersion: "0.1.2-test", exportedAt: "2026-07-17T12:00:00Z" };
const bundle = buildDebugBundle({
  session: { id: "s1", status: "completed" },
  familiar: { id: "f1", display_name: "Nova", role: "dev", harness: "claude", model: "opus" },
  turns: [{ id: "t1", role: "user", text: "hi", createdAt: "2026-06-10T00:00:00Z" }],
  events: [ev(1)],
  environment: env,
});
assert.equal(bundle.session.id, "s1");
assert.deepEqual(bundle.familiar, { id: "f1", harness: "claude", model: "opus" });
assert.equal(bundle.turns.length, 1);
assert.equal(bundle.events.length, 1);
assert.deepEqual(bundle.environment, env, "bundle carries the repro environment block verbatim");
assert.equal(
  buildDebugBundle({ session: null, familiar: null, turns: [], events: [], environment: env }).familiar,
  null,
);
const turnsRef = [{ id: "t1", role: "user", text: "hi", createdAt: "2026-06-10T00:00:00Z" }];
assert.equal(
  buildDebugBundle({ session: null, familiar: null, turns: turnsRef, events: [], environment: env }).turns,
  turnsRef,
  "attachment-free turns are passed by reference, not cloned",
);

// exportDebugTurn: preview-only attachment fields are stripped from exports
import { exportDebugTurn } from "./session-debug.ts";

const plainTurn = { id: "t1", role: "user", text: "hi", createdAt: "2026-06-10T00:00:00Z" };
assert.equal(exportDebugTurn(plainTurn), plainTurn, "no attachments → same reference (no clone)");

const attachedTurn = {
  ...plainTurn,
  attachments: [
    { name: "shot.png", mimeType: "image/png", size: 12, dataUrl: "data:image/png;base64,AAAA" },
  ],
};
const exported = exportDebugTurn(attachedTurn);
assert.deepEqual(
  exported.attachments,
  [{ name: "shot.png", size: 12 }],
  "preview-only fields (dataUrl, mimeType) are stripped; metadata survives",
);
assert.deepEqual(
  attachedTurn.attachments[0].dataUrl,
  "data:image/png;base64,AAAA",
  "the live turn is not mutated by exporting",
);
const strippedBundle = buildDebugBundle({
  session: null,
  familiar: null,
  turns: [attachedTurn],
  events: [],
  environment: env,
});
assert.equal(
  strippedBundle.turns[0].attachments[0].dataUrl,
  undefined,
  "bundle turns go through exportDebugTurn — no base64 previews in Copy all / Download",
);

// debugFileName
assert.equal(debugFileName("s1"), "debug-s1.json");
assert.equal(debugFileName(null), "debug-session.json");

// ── turnActualModel / turnMetaSummary: served-model + usage meta (S2) ───────
import { turnActualModel, turnMetaSummary } from "./session-debug.ts";

const baseTurn = { id: "t1", role: "assistant", text: "hi", createdAt: "2026-07-17T00:00:00Z" };

assert.equal(turnActualModel(baseTurn), null, "no responseMetadata → no served model");
assert.equal(
  turnActualModel({ ...baseTurn, responseMetadata: { model: "opus-4" } }),
  "opus-4",
  "requested model reported when no confirmation exists",
);
assert.equal(
  turnActualModel({ ...baseTurn, responseMetadata: { model: "opus-4", confirmedModel: "sonnet-4.6" } }),
  "sonnet-4.6",
  "confirmedModel (post-application truth) wins over the requested model",
);
assert.equal(
  turnActualModel({ ...baseTurn, responseMetadata: { model: "  " } }),
  null,
  "whitespace-only model is not a model",
);

assert.equal(turnMetaSummary(baseTurn), null, "no model, no usage → null (row shows nothing)");
assert.equal(
  turnMetaSummary({ ...baseTurn, responseMetadata: { model: "opus-4" } }),
  "opus-4",
  "model-only meta",
);
assert.equal(
  turnMetaSummary({ ...baseTurn, usage: { inputTokens: 1000, outputTokens: 234 }, costUsd: 0.08 }),
  "1.2k tok · $0.08",
  "usage-only meta reuses the shared usageSummary formatter",
);
assert.equal(
  turnMetaSummary({
    ...baseTurn,
    responseMetadata: { confirmedModel: "sonnet-4.6" },
    usage: { inputTokens: 1000, outputTokens: 234 },
    costUsd: 0.08,
  }),
  "sonnet-4.6 · 1.2k tok · $0.08",
  "combined meta: served model first, then tokens/cost",
);
assert.equal(
  turnMetaSummary({ ...baseTurn, usage: { inputTokens: 0, outputTokens: 0 } }),
  null,
  "zero-token usage with no cost reports nothing, not '0 tok'",
);

console.log("session-debug core assertions passed");

// ═══════════════════════════════════════════════════════════════════════════
// CHAT-D4-01 — interleaved tool segments (src/lib/turn-segments.ts).
// Lives here because test:app is an explicit script list (no package.json
// edits) and this is the non-contended lib test file in it.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { segmentTurn } from "./turn-segments.ts";

// ── Legacy passthrough: turns without offsets render exactly as today ──────
assert.equal(segmentTurn("some text", undefined), null, "no tools → null (legacy)");
assert.equal(segmentTurn("some text", []), null, "empty tools → null (legacy)");
assert.equal(
  segmentTurn("some text", [{ id: "a" }]),
  null,
  "tools without textOffset (stored transcripts) → null (legacy trailing rollup)",
);
assert.equal(
  segmentTurn("some text", [{ id: "a", textOffset: 0 }, { id: "b" }]),
  null,
  "ANY tool missing an offset disables segmentation — never a half-interleaved turn",
);

// ── Basic interleave: tool between paragraphs, in chronological order ──────
{
  const text = "Intro para.\n\nSecond para.\n\nThird para.";
  // Tool arrived mid-first-paragraph (offset 4): snaps FORWARD to the start
  // of the next paragraph, never splitting a paragraph in half.
  const segs = segmentTurn(text, [{ id: "t1", textOffset: 4 }]);
  assert.deepEqual(
    segs.map((s) => s.kind),
    ["text", "tools", "text"],
    "tool renders between prose spans",
  );
  assert.equal(segs[0].text, "Intro para.\n\n", "first span is a verbatim slice");
  assert.equal(segs[2].text, "Second para.\n\nThird para.");
  assert.equal(
    segs.filter((s) => s.kind === "text").map((s) => s.text).join(""),
    text,
    "text spans reassemble the full text verbatim",
  );
}

// ── Offset 0: tool that ran before any prose renders FIRST ─────────────────
{
  const segs = segmentTurn("Answer prose.", [{ id: "t1", textOffset: 0 }]);
  assert.deepEqual(segs.map((s) => s.kind), ["tools", "text"], "pre-prose tool leads the turn");
}

// ── Past-end offsets clamp to a trailing group (graceful degradation) ──────
{
  const segs = segmentTurn("Short.", [{ id: "t1", textOffset: 9999 }]);
  assert.deepEqual(segs.map((s) => s.kind), ["text", "tools"]);
}

// ── Fence safety: blank lines INSIDE a code fence are not boundaries ───────
{
  const text = "Before.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.";
  // Offset lands inside the fence (after "const a = 1;") — must snap past
  // the fence to the paragraph after it, never splitting the fence open.
  const inFence = text.indexOf("const b") - 1;
  const segs = segmentTurn(text, [{ id: "t1", textOffset: inFence }]);
  assert.deepEqual(segs.map((s) => s.kind), ["text", "tools", "text"]);
  assert.ok(segs[0].text.includes("```\n"), "the whole fence stays in the span before the tool");
  assert.equal(segs[2].text, "After.");
  const fenceCount = (segs[0].text.match(/```/g) ?? []).length;
  assert.equal(fenceCount % 2, 0, "no span ends inside an unterminated fence");
}

// ── Same-offset tools group consecutively, preserving arrival order ────────
{
  const text = "Para one.\n\nPara two.";
  const segs = segmentTurn(text, [
    { id: "first", textOffset: 3 },
    { id: "second", textOffset: 3 },
  ]);
  assert.deepEqual(segs.map((s) => s.kind), ["text", "tools", "text"]);
  assert.deepEqual(
    segs[1].tools.map((t) => t.id),
    ["first", "second"],
    "same-offset tools render as one consecutive group in arrival order",
  );
}

// ── Streaming stability: appended text lands AFTER the tool ────────────────
{
  // Tool arrived when the text was exactly "First para." (offset = length).
  const tools = [{ id: "t1", textOffset: "First para.".length }];
  const before = segmentTurn("First para.", tools);
  assert.deepEqual(before.map((s) => s.kind), ["text", "tools"], "mid-stream: tool trails current text");
  // More text streams in: it belongs to the NEXT span; the prose before the
  // tool is unchanged — settled spans never move retroactively.
  const after = segmentTurn("First para.\n\nSecond para.", tools);
  assert.deepEqual(after.map((s) => s.kind), ["text", "tools", "text"]);
  assert.equal(after[0].text.trim(), before[0].text.trim(), "span before the tool is stable across appends");
  assert.equal(after[2].text, "Second para.", "appended text falls into the following span");
}

// ── Tool-only turn (no prose yet): pure tool segments ──────────────────────
{
  const segs = segmentTurn("", [{ id: "t1", textOffset: 0 }]);
  assert.deepEqual(segs.map((s) => s.kind), ["tools"]);
}

// ── Source pins ─────────────────────────────────────────────────────────────
const chatViewSource = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const bubbleSource = readFileSync(new URL("../components/message-bubble.tsx", import.meta.url), "utf8");
const turnSegmentsSource = readFileSync(new URL("./turn-segments.ts", import.meta.url), "utf8");
const convRouteSource = readFileSync(
  new URL("../app/api/chat/conversation/[id]/route.ts", import.meta.url),
  "utf8",
);

// The tool_use SSE handler captures the offset at the tool's FIRST event —
// the length of the text accumulated so far — and settle events preserve it.
assert.match(
  chatViewSource,
  /\[\.\.\.tools, \{ \.\.\.incoming, textOffset: t\.text\.length \}\]/,
  "CHAT-D4-01: new tool events record the accumulated text length as textOffset",
);
assert.match(
  chatViewSource,
  /textOffset: x\.textOffset,/,
  "CHAT-D4-01: settle/update events keep the offset captured at first arrival",
);
assert.doesNotMatch(
  turnSegmentsSource,
  /always lands in the span FOLLOWING that tool/,
  "CHAT-D4-01: turn-segments comments must not overstate mid-paragraph snap behavior",
);
assert.match(
  turnSegmentsSource,
  /later text in that same paragraph[\s\S]*?can remain before the tool/,
  "CHAT-D4-01: turn-segments comments should document mid-paragraph streaming behavior",
);

// TurnRow renders the segmented path from the reasoning-stripped visible
// text, and keeps the trailing ToolGroup ONLY as the legacy (no-offset) path.
assert.match(
  chatViewSource,
  /const segments = segmentTurn\(visible, turn\.tools\)/,
  "CHAT-D4-01: assistant turns segment the visible text by tool offsets",
);
assert.match(
  chatViewSource,
  /!turn\.pending && turn\.tools\?\.length[\s\S]*otherTools\.length \? <ToolGroup tools=\{otherTools\} \/>/,
  "settled turns render edit-tool cards inline and collapse other tool activity into the ToolGroup",
);
assert.match(
  chatViewSource,
  /seg\.tools\.map\(\(tool\) => <ToolBlock key=\{tool\.id\} tool=\{tool\} \/>\)/,
  "CHAT-D4-01: interleaved tools reuse the existing collapsed ToolBlock",
);

// MessageBubble: only the LAST text span streams (progressive markdown +
// cursor); settled spans render with pending=false.
assert.match(
  bubbleSource,
  /pending=\{pending && i === lastTextIdx\}/,
  "CHAT-D4-01: the ▌ cursor / progressive render applies only to the last text span",
);
assert.match(
  bubbleSource,
  /<MarkdownContent text=\{content\} pending=\{pending\} onOpenUrl=\{onOpenUrl\} \/>/,
  "CHAT-D4-01: segment-less bubbles keep the single MarkdownContent render",
);

// Round-trip: the conversation write route passes tool arrays through whole,
// so textOffset on persisted tools survives serialization without migration.
assert.match(
  convRouteSource,
  /\.\.\.\(Array\.isArray\(value\.tools\) \? \{ tools: value\.tools \} : \{\}\)/,
  "CHAT-D4-01: conversation route round-trips whole tool objects (textOffset survives)",
);

console.log("turn-segments (CHAT-D4-01) tests passed");
