import assert from "node:assert/strict";
import test from "node:test";
import { groupTranscriptTurns } from "./chat-transcript-groups.ts";
import { chatTranscriptFold } from "./chat-transcript-fold.ts";
import {
  CHAT_TRANSCRIPT_WINDOW_GROUPS,
  CHAT_TRANSCRIPT_WINDOW_OVERLAP,
  chatTranscriptWindow,
  chatTranscriptWindowForTurn,
  pageChatTranscriptWindow,
} from "./chat-transcript-window.ts";

const turns = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `t${index}`, text: `turn ${index}`, role: "assistant" as const,
  createdAt: "2026-09-01T00:00:00Z",
}));
const groups = groupTranscriptTurns(turns(1000)).groupedTurns;

test("empty, short, exact-cap and long transcripts always fit the group budget", () => {
  for (const count of [0, 1, 6, 59, 60, 61, 1000, 10000]) {
    const range = chatTranscriptWindow(count, null);
    assert.equal(range.end, count);
    assert.equal(range.start, Math.max(0, count - CHAT_TRANSCRIPT_WINDOW_GROUPS));
    assert.ok(range.end - range.start <= CHAT_TRANSCRIPT_WINDOW_GROUPS);
  }
});

test("unfolding keeps the whole-transcript fold count and mounts only 60 groups", () => {
  assert.deepEqual(chatTranscriptFold(groups), { startIndex: 994, hiddenTurns: 994 });
  const range = chatTranscriptWindow(groups.length, null);
  assert.equal(groups.slice(range.start, range.end).length, 60);
});

test("repeated older and newer paging reaches every group without accumulation", () => {
  for (const direction of [-1, 1] as const) {
    let range = chatTranscriptWindow(groups.length, direction === -1 ? null : 0);
    const seen = new Set<number>();
    for (let step = 0; step < 100; step += 1) {
      for (let index = range.start; index < range.end; index += 1) seen.add(index);
      const next = pageChatTranscriptWindow(groups.length, range.start, direction);
      assert.ok(next.end - next.start <= CHAT_TRANSCRIPT_WINDOW_GROUPS);
      assert.ok(Math.min(next.end, range.end) - Math.max(next.start, range.start) >= CHAT_TRANSCRIPT_WINDOW_OVERLAP);
      if (range.start === next.start) break;
      range = next;
    }
    assert.equal(seen.size, groups.length);
    assert.equal(direction === -1 ? range.start : range.end, direction === -1 ? 0 : groups.length);
  }
});

test("a released window stays put during streaming; explicit latest resets to tail", () => {
  const released = chatTranscriptWindow(1000, null);
  assert.deepEqual(chatTranscriptWindow(1050, released.start), released);
  assert.deepEqual(chatTranscriptWindow(1050, null), { start: 990, end: 1050 });
});

test("session/branch shrink and malformed persisted offsets clamp to valid ranges", () => {
  assert.deepEqual(chatTranscriptWindow(10, 900), { start: 0, end: 10 });
  assert.deepEqual(chatTranscriptWindow(1000, -8), { start: 0, end: 60 });
  assert.deepEqual(chatTranscriptWindow(1000, 1.9), { start: 1, end: 61 });
  assert.deepEqual(chatTranscriptWindow(1000, Number.NaN), { start: 940, end: 1000 });
});

test("every find target selects a bounded containing range without walking pages", () => {
  for (let index = 0; index < groups.length; index += 1) {
    const range = chatTranscriptWindowForTurn(groups, `t${index}`, null);
    assert.ok(range);
    assert.ok(index >= range.start && index < range.end);
    assert.ok(range.end - range.start <= CHAT_TRANSCRIPT_WINDOW_GROUPS);
  }
  assert.equal(chatTranscriptWindowForTurn(groups, "inactive-branch-turn", null), null);
  assert.deepEqual(chatTranscriptWindowForTurn(groups, "t980", null), { start: 940, end: 1000 });
});

test("a find match inside a large voice call selects that entire atomic group", () => {
  const voiceTurns = turns(100).map((turn, index) => ({
    ...turn, id: `voice-${index}`, voiceCallId: "call",
  }));
  const transcript = [...turns(400), ...voiceTurns, ...turns(100).map((turn) => ({ ...turn, id: `tail-${turn.id}` }))];
  const voiceGroups = groupTranscriptTurns(transcript).groupedTurns;
  const range = chatTranscriptWindowForTurn(voiceGroups, "voice-99", 0);
  assert.ok(range);
  const mounted = voiceGroups.slice(range.start, range.end);
  assert.ok(mounted.length <= 60);
  const call = mounted.find((group) => group.kind === "call");
  assert.ok(call?.kind === "call");
  assert.equal(call.turns.length, 100, "the budget is groups, not individual turns within a call");
});
