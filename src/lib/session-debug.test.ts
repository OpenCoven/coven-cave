// @ts-nocheck
import assert from "node:assert/strict";
import {
  appendEvents,
  nextAfterSeq,
  isDebugSessionLive,
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

// isDebugSessionLive: any witness saying "live" wins — sessions-list status,
// client transport phase, or the server run buffer (done: false)
{
  const idle = { status: null, clientPhase: "idle", serverStatus: null };
  const buffer = (done) => ({
    done,
    oldestRetainedSeq: 1,
    latestSeq: 5,
    retainedEventCount: 5,
    retainedBytes: 100,
    hasEvictedEvents: false,
    liveTails: 0,
  });
  assert.equal(isDebugSessionLive(idle), false, "no witness => not live");
  assert.equal(isDebugSessionLive({ ...idle, status: "running" }), true, "sessions-list row wins");
  for (const clientPhase of ["connecting", "streaming", "resuming"]) {
    assert.equal(
      isDebugSessionLive({ ...idle, clientPhase }),
      true,
      `client ${clientPhase} phase wins without a sessions-list row (poll lag / missing row)`,
    );
  }
  for (const clientPhase of ["settled", "degraded", "stopped"]) {
    assert.equal(
      isDebugSessionLive({ ...idle, clientPhase }),
      false,
      `terminal client ${clientPhase} phase is not a live witness`,
    );
  }
  assert.equal(
    isDebugSessionLive({ ...idle, serverStatus: buffer(false) }),
    true,
    "an undone server run buffer self-detects runs this pane didn't start",
  );
  assert.equal(
    isDebugSessionLive({ ...idle, serverStatus: buffer(true) }),
    false,
    "a finished buffer is not a live witness",
  );
  assert.equal(
    isDebugSessionLive({ status: "completed", clientPhase: "settled", serverStatus: buffer(true) }),
    false,
    "all witnesses terminal => not live",
  );
}

// shouldPollEvents: only while live and visible
assert.equal(shouldPollEvents({ live: true, visible: true }), true);
assert.equal(shouldPollEvents({ live: true, visible: false }), false);
assert.equal(shouldPollEvents({ live: false, visible: true }), false);

// filterEvents: case-insensitive over kind + raw payload; reference-stable when blank
import { filterEvents } from "./session-debug.ts";
{
  const tail = [
    { ...ev(1, "tool_use"), payload_json: '{"name":"grep"}' },
    { ...ev(2, "output"), payload_json: '{"data":"Error: ENOENT /tmp/x"}' },
    { ...ev(3, "lifecycle"), payload_json: "{}" },
  ];
  assert.equal(filterEvents(tail, ""), tail, "blank query returns the same array (memo bail)");
  assert.equal(filterEvents(tail, "   "), tail, "whitespace-only query is blank");
  assert.deepEqual(
    filterEvents(tail, "TOOL").map((e) => e.seq),
    [1],
    "kind matches are case-insensitive",
  );
  assert.deepEqual(
    filterEvents(tail, "enoent").map((e) => e.seq),
    [2],
    "payload text matches without parsing the JSON",
  );
  assert.deepEqual(filterEvents(tail, "nope").map((e) => e.seq), [], "no match → empty");
}

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
const streamHealth = {
  client: {
    phase: "streaming",
    runId: "run-1",
    cursor: 7,
    resumeAttempts: 1,
    gapDetected: false,
    needsTranscriptResync: false,
    lastEventAt: "2026-07-17T11:59:59Z",
    lastErrorAt: null,
    lastError: null,
  },
  server: {
    done: false,
    oldestRetainedSeq: 2,
    latestSeq: 7,
    retainedEventCount: 6,
    retainedBytes: 4096,
    hasEvictedEvents: true,
    liveTails: 1,
  },
  serverStatusError: null,
};
const bundle = buildDebugBundle({
  session: { id: "s1", status: "completed" },
  familiar: { id: "f1", display_name: "Nova", role: "dev", harness: "claude", model: "opus" },
  turns: [{ id: "t1", role: "user", text: "hi", createdAt: "2026-06-10T00:00:00Z" }],
  events: [ev(1)],
  streamHealth,
  environment: env,
});
assert.equal(bundle.session.id, "s1");
assert.deepEqual(bundle.familiar, { id: "f1", harness: "claude", model: "opus" });
assert.equal(bundle.turns.length, 1);
assert.equal(bundle.events.length, 1);
assert.equal(bundle.streamHealth, streamHealth, "bundle carries the exact stream-health snapshot reference");
assert.deepEqual(bundle.environment, env, "bundle carries the repro environment block verbatim");
assert.equal(
  buildDebugBundle({ session: null, familiar: null, turns: [], events: [], streamHealth, environment: env })
    .familiar,
  null,
);
const turnsRef = [{ id: "t1", role: "user", text: "hi", createdAt: "2026-06-10T00:00:00Z" }];
assert.equal(
  buildDebugBundle({
    session: null,
    familiar: null,
    turns: turnsRef,
    events: [],
    streamHealth,
    environment: env,
  }).turns,
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
  streamHealth,
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

// ── per-session debug events cache: reopen restores the drained tail (A2) ───
import {
  clearDebugEventsCacheForTest,
  readDebugEventsCache,
  writeDebugEventsCache,
} from "./session-debug.ts";

{
  clearDebugEventsCacheForTest();
  assert.equal(readDebugEventsCache("s1"), null, "cold cache → null (pane starts from seq 0)");

  const tail = { events: [ev(1), ev(2)], cursor: 2, tailCapped: false };
  writeDebugEventsCache("s1", tail);
  assert.equal(readDebugEventsCache("s1"), tail, "hit returns the exact stored snapshot");

  const capped = { events: [ev(1), ev(2), ev(3)], cursor: 3, tailCapped: true };
  writeDebugEventsCache("s1", capped);
  assert.equal(readDebugEventsCache("s1"), capped, "rewrite replaces the snapshot for the key");
  assert.equal(
    readDebugEventsCache("s1").tailCapped,
    true,
    "tailCapped survives the round-trip so the Load-more notice reappears on reopen",
  );

  // LRU bound: writing beyond the cap evicts the least recently touched key.
  clearDebugEventsCacheForTest();
  for (let i = 0; i < 8; i++) {
    writeDebugEventsCache(`s${i}`, { events: [ev(1)], cursor: 1, tailCapped: false });
  }
  readDebugEventsCache("s0"); // touch s0 so s1 is now the oldest
  writeDebugEventsCache("s8", { events: [ev(1)], cursor: 1, tailCapped: false });
  assert.notEqual(readDebugEventsCache("s0"), null, "recently read key survives eviction");
  assert.equal(readDebugEventsCache("s1"), null, "least recently touched key is evicted at the cap");
  assert.notEqual(readDebugEventsCache("s8"), null, "newest write is retained");

  clearDebugEventsCacheForTest();
  assert.equal(readDebugEventsCache("s8"), null, "test hook clears the cache");
}

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
// CHAT-D4-01 — tool timing metadata and compact consecutive runs.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { groupConsecutiveTools } from "./turn-segments.ts";

// ── Consecutive repeated tool runs stay bounded by a different tool ───────
{
  const runs = groupConsecutiveTools([
    { id: "read-1", name: "Read" },
    { id: "read-2", name: " read " },
    { id: "grep-1", name: "Grep" },
    { id: "read-3", name: "Read" },
  ]);
  assert.deepEqual(
    runs.map((run) => run.tools.map((tool) => tool.id)),
    [["read-1", "read-2"], ["grep-1"], ["read-3"]],
    "only adjacent calls with the same normalized name roll up",
  );
  assert.deepEqual(
    runs.map((run) => run.name),
    ["Read", "Grep", "Read"],
    "each run retains the first call's display name",
  );

  const separatedByProse = groupConsecutiveTools([
    { id: "read-before", name: "Read", textOffset: 0 },
    { id: "read-after", name: "Read", textOffset: 24 },
  ]);
  assert.deepEqual(
    separatedByProse.map((run) => run.tools.map((tool) => tool.id)),
    [["read-before"], ["read-after"]],
    "same-name calls captured on opposite sides of prose never roll up",
  );

  const unknownBetweenKnownBoundaries = groupConsecutiveTools([
    { id: "read-at-start", name: "Read", textOffset: 0 },
    { id: "read-without-offset", name: "Read" },
    { id: "read-after-prose", name: "Read", textOffset: 24 },
  ]);
  assert.deepEqual(
    unknownBetweenKnownBoundaries.map((run) => run.tools.map((tool) => tool.id)),
    [["read-at-start", "read-without-offset"], ["read-after-prose"]],
    "an unknown offset does not erase the last known prose boundary",
  );

  const unknownBetweenConsecutiveCalls = groupConsecutiveTools([
    { id: "read-known-1", name: "Read", textOffset: 8 },
    { id: "read-legacy", name: "Read" },
    { id: "read-known-2", name: "Read", textOffset: 8 },
  ]);
  assert.deepEqual(
    unknownBetweenConsecutiveCalls.map((run) => run.tools.map((tool) => tool.id)),
    [["read-known-1", "read-legacy", "read-known-2"]],
    "an unknown offset still joins truly consecutive calls at the same known boundary",
  );

  const leadingUnknownOffset = groupConsecutiveTools([
    { id: "read-legacy-first", name: "Read" },
    { id: "read-known-before", name: "Read", textOffset: 0 },
    { id: "read-known-after", name: "Read", textOffset: 12 },
  ]);
  assert.deepEqual(
    leadingUnknownOffset.map((run) => run.tools.map((tool) => tool.id)),
    [["read-legacy-first", "read-known-before"], ["read-known-after"]],
    "the first known offset becomes the boundary for a legacy-started run",
  );

  const mixedNameWithMissingOffset = groupConsecutiveTools([
    { id: "read-at-0", name: "Read", textOffset: 0 },
    { id: "bash-missing", name: "Bash" },
    { id: "bash-at-24", name: "Bash", textOffset: 24 },
  ]);
  assert.deepEqual(
    mixedNameWithMissingOffset.map((run) => run.tools.map((tool) => tool.id)),
    [["read-at-0"], ["bash-missing"], ["bash-at-24"]],
    "name change with missing offset does not reset boundary context for same-name calls",
  );
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
  /\bsegmentTurn\b|TurnSegment|SegmentedTool/,
  "CHAT-D4-01: the unused local prose-segmentation pipeline stays removed",
);
assert.match(
  turnSegmentsSource,
  /export function groupConsecutiveTools/,
  "CHAT-D4-01: compact consecutive-run grouping remains",
);

// TurnRow keeps stateful tool UI in fixed slots across streaming settlement.
// Rendering tools through prose segments would relocate focused controls.
assert.match(
  chatViewSource,
  /<ChatToolActivityLayout[\s\S]*activity=\{otherTools\.length \? <ToolGroup tools=\{otherTools\} \/> : null\}[\s\S]*content=\{[\s\S]*<MessageBubble[\s\S]*editCards=\{/,
  "assistant turns keep non-edit activity, changing turn content, and edit cards in stable render slots",
);
assert.match(
  chatViewSource,
  /const turnTools = turn\.tools \?\? \[\];[\s\S]*const indexedTurnTools = turnTools\.map\(\(tool, originalIndex\)[\s\S]*const editToolIds = new Set\([\s\S]*isFileMutationTool\(tool\.name\)[\s\S]*const editCards = indexedTurnTools[\s\S]*const otherTools = indexedTurnTools[\s\S]*originalIndex/,
  "pending and settled turns share one id-keyed partition that retains original adjacency",
);
assert.doesNotMatch(
  chatViewSource.match(/function TurnRowImpl[\s\S]*?\n}\n\nfunction ReasoningBlock/)?.[0] ?? "",
  /<ToolRuns/,
  "TurnRow does not duplicate ToolRuns in prose or tool-first branches",
);

// MessageBubble: only the LAST text span streams (progressive markdown);
// settled spans render with pending=false. The cursor this once also gated
// was removed in cave-1yslk; `pending` still drives progressive rendering.
assert.match(
  bubbleSource,
  /pending=\{pending && i === lastTextIdx\}/,
  "CHAT-D4-01: progressive render applies only to the last text span",
);
assert.match(
  bubbleSource,
  /\{segments\?\.length \? \([\s\S]*?\) : \(\s*<MarkdownContent\s+text=\{cited\.body\}\s+pending=\{pending\}\s+onOpenUrl=\{onOpenUrl\}\s+citations=\{cited\.citations\}\s+decorateResponse\s+projectRoot=\{projectRoot\}\s+messageId=\{messageId\}\s*\/>\s*\)\}/,
  "CHAT-D4-01: segment-less turns keep one provenance-aware MarkdownContent in the stable content slot",
);

// Round-trip: the conversation write route passes tool arrays through whole,
// so textOffset on persisted tools survives serialization without migration.
assert.match(
  convRouteSource,
  /\.\.\.\(Array\.isArray\(value\.tools\) \? \{ tools: value\.tools \} : \{\}\)/,
  "CHAT-D4-01: conversation route round-trips whole tool objects (textOffset survives)",
);

console.log("tool timing/grouping (CHAT-D4-01) tests passed");
