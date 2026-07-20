import assert from "node:assert/strict";
import { test } from "node:test";
import { groupTranscriptTurns } from "./chat-transcript-groups.ts";

const turn = (id: string, createdAt: string, voiceCallId?: string) => ({
  id, createdAt, voiceCallId, role: "assistant" as const, text: "", pending: false,
});

test("groups adjacent voice turns without merging separate calls", () => {
  const turns = [
    turn("one", "2026-01-01T00:00:00.000Z", "call-a"),
    turn("two", "2026-01-01T00:00:05.900Z", "call-a"),
    turn("three", "2026-01-01T00:00:06.000Z"),
    turn("four", "2026-01-01T00:01:00.000Z", "call-a"),
  ];
  const { groupedTurns, turnIndexMap } = groupTranscriptTurns(turns);
  assert.equal(groupedTurns.length, 3);
  assert.deepEqual(groupedTurns[0], { kind: "call", callId: "call-a", turns: turns.slice(0, 2), durationSec: 5 });
  assert.deepEqual(groupedTurns[1], { kind: "single", turn: turns[2] });
  assert.deepEqual(groupedTurns[2], { kind: "call", callId: "call-a", turns: [turns[3]], durationSec: 0 });
  assert.deepEqual([...turnIndexMap], [["one", 0], ["two", 1], ["three", 2], ["four", 3]]);
});
