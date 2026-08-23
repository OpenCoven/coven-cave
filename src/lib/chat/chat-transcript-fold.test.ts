import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_FOLD_KEEP_GROUPS,
  CHAT_FOLD_MIN_HIDDEN_TURNS,
  chatFoldAriaLabel,
  chatFoldLabel,
  chatTranscriptFold,
} from "./chat-transcript-fold.ts";
import type { TranscriptGroup } from "./chat-transcript-groups.ts";
import type { Turn } from "./chat-turn-state.ts";

const turn = (id: string): Turn => ({ id, role: "user", text: id }) as Turn;
const single = (id: string): TranscriptGroup => ({ kind: "single", turn: turn(id) });
const call = (id: string, n: number): TranscriptGroup => ({
  kind: "call",
  callId: id,
  turns: Array.from({ length: n }, (_, i) => turn(`${id}-${i}`)),
  durationSec: 60,
});
const singles = (n: number) => Array.from({ length: n }, (_, i) => single(`t${i}`));

test("a thread that fits on screen never folds", () => {
  assert.deepEqual(chatTranscriptFold([]), { startIndex: 0, hiddenTurns: 0 });
  assert.deepEqual(chatTranscriptFold(singles(1)), { startIndex: 0, hiddenTurns: 0 });
  assert.deepEqual(
    chatTranscriptFold(singles(CHAT_FOLD_KEEP_GROUPS)),
    { startIndex: 0, hiddenTurns: 0 },
    "exactly the keep count is not folded — there is nothing behind the pill",
  );
});

test("folding one or two turns is not worth a divider", () => {
  // The control would cost a row to save a row. Below the floor, show them.
  for (let extra = 1; extra < CHAT_FOLD_MIN_HIDDEN_TURNS; extra += 1) {
    assert.deepEqual(
      chatTranscriptFold(singles(CHAT_FOLD_KEEP_GROUPS + extra)),
      { startIndex: 0, hiddenTurns: 0 },
      `${extra} hidden turn(s) stays unfolded`,
    );
  }
});

test("the fold engages at the floor and keeps the recent exchange visible", () => {
  const groups = singles(CHAT_FOLD_KEEP_GROUPS + CHAT_FOLD_MIN_HIDDEN_TURNS);
  const fold = chatTranscriptFold(groups);
  assert.equal(fold.hiddenTurns, CHAT_FOLD_MIN_HIDDEN_TURNS);
  assert.equal(fold.startIndex, CHAT_FOLD_MIN_HIDDEN_TURNS);
  assert.equal(
    groups.length - fold.startIndex,
    CHAT_FOLD_KEEP_GROUPS,
    "the visible tail is always the keep count",
  );
});

test("a long thread folds everything above the tail", () => {
  const fold = chatTranscriptFold(singles(50));
  assert.equal(fold.startIndex, 50 - CHAT_FOLD_KEEP_GROUPS);
  assert.equal(fold.hiddenTurns, 50 - CHAT_FOLD_KEEP_GROUPS);
});

test("the count is in TURNS, so a folded voice call cannot understate itself", () => {
  // One call group carrying eight turns sits above six singles. Counting
  // groups would put "1 earlier turn" over a fold hiding eight.
  const groups = [call("c1", 8), ...singles(CHAT_FOLD_KEEP_GROUPS)];
  const fold = chatTranscriptFold(groups);
  assert.equal(fold.startIndex, 1, "the call is one group");
  assert.equal(fold.hiddenTurns, 8, "but eight turns are behind the fold");
});

test("a folded call below the floor still counts its turns toward engaging", () => {
  // A single call group of 3 turns is 1 group but 3 turns — over the floor.
  const groups = [call("c1", 3), ...singles(CHAT_FOLD_KEEP_GROUPS)];
  assert.equal(chatTranscriptFold(groups).hiddenTurns, 3);
  // …and a 2-turn call is under it.
  const short = [call("c2", 2), ...singles(CHAT_FOLD_KEEP_GROUPS)];
  assert.equal(chatTranscriptFold(short).hiddenTurns, 0);
});

test("the label never claims turns are hidden while they are on screen", () => {
  assert.equal(chatFoldLabel(3, false), "3 earlier turns");
  assert.equal(chatFoldLabel(1, false), "1 earlier turn");
  assert.equal(chatFoldLabel(12, true), "hide earlier turns");
  assert.equal(chatFoldAriaLabel(3, false), "Show 3 earlier turns");
  assert.equal(chatFoldAriaLabel(1, false), "Show 1 earlier turn");
  assert.equal(chatFoldAriaLabel(3, true), "Hide earlier turns");
});
