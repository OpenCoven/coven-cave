// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFinal,
  applyPartial,
  applySpeaking,
  emptyTranscript,
  MAX_CALL_TURNS,
  speakingTurnId,
  splitSpokenText,
} from "./call-transcript.ts";

test("partials replace the open turn instead of stacking bubbles", () => {
  let t = applyPartial(emptyTranscript, "user", "light the");
  t = applyPartial(t, "user", "light the candles");
  assert.equal(t.turns.length, 1);
  assert.equal(t.turns[0].text, "light the candles");
  assert.equal(t.turns[0].final, false);
});

test("a partial from the other role opens its own turn", () => {
  let t = applyPartial(emptyTranscript, "user", "light the candles");
  t = applyPartial(t, "assistant", "All seven of");
  assert.deepEqual(
    t.turns.map((turn) => [turn.role, turn.text]),
    [
      ["user", "light the candles"],
      ["assistant", "All seven of"],
    ],
  );
  assert.notEqual(t.turns[0].id, t.turns[1].id, "turn ids stay unique");
});

test("a final settles the open turn it was built from", () => {
  let t = applyPartial(emptyTranscript, "assistant", "All seven of");
  t = applyFinal(t, "assistant", "All seven of them are lit.");
  assert.equal(t.turns.length, 1);
  assert.equal(t.turns[0].text, "All seven of them are lit.");
  assert.equal(t.turns[0].final, true);
});

test("a repeated final does not stutter the transcript", () => {
  // Realtime providers emit a `done` transcript for text the overlay may
  // already have settled.
  let t = applyFinal(emptyTranscript, "assistant", "All seven are lit.");
  t = applyFinal(t, "assistant", "All seven are lit.");
  assert.equal(t.turns.length, 1);
});

test("a final with no open turn lands as its own turn", () => {
  let t = applyFinal(emptyTranscript, "user", "light the candles");
  t = applyFinal(t, "assistant", "Done.");
  assert.deepEqual(
    t.turns.map((turn) => turn.role),
    ["user", "assistant"],
  );
});

test("blank text never opens a turn", () => {
  assert.equal(applyPartial(emptyTranscript, "user", "   ").turns.length, 0);
  assert.equal(applyFinal(emptyTranscript, "user", "\n").turns.length, 0);
});

test("a long call keeps a bounded window of turns", () => {
  let t = emptyTranscript;
  for (let i = 0; i < MAX_CALL_TURNS + 12; i += 1) {
    t = applyFinal(t, i % 2 === 0 ? "user" : "assistant", `turn ${i}`);
  }
  assert.equal(t.turns.length, MAX_CALL_TURNS);
  assert.equal(t.turns[t.turns.length - 1].text, `turn ${MAX_CALL_TURNS + 11}`);
});

test("speaking is normalized and clears", () => {
  const t = applySpeaking(emptyTranscript, "  All seven are lit.  ");
  assert.equal(t.speaking, "All seven are lit.");
  assert.equal(applySpeaking(t, null).speaking, null);
  assert.equal(applySpeaking(t, "   ").speaking, null);
  assert.equal(applySpeaking(t, "All seven are lit."), t, "an unchanged utterance is not a new state");
});

test("splitSpokenText brackets the spoken sentence inside the turn", () => {
  const text = "The candles are lit. All seven of them. Shall we begin?";
  const split = splitSpokenText(text, "All seven of them.");
  assert.equal(split.before, "The candles are lit. ");
  assert.equal(split.match, "All seven of them.");
  assert.equal(split.after, " Shall we begin?");
});

test("splitSpokenText tolerates rewrapped whitespace", () => {
  // The chunker trims what it hands the mouth; a streamed reply can wrap
  // differently by the time it settles.
  const split = splitSpokenText("Ready when you\nare, witch.", "Ready when you are,");
  assert.equal(split.match, "Ready when you\nare,");
  assert.equal(split.after, " witch.");
});

test("splitSpokenText never drops words when the utterance is absent", () => {
  const split = splitSpokenText("Nothing like it here.", "a sentence from another turn");
  assert.equal(split.before, "Nothing like it here.");
  assert.equal(split.match, "");
  assert.equal(split.after, "");
});

test("splitSpokenText survives regex-shaped utterances", () => {
  const split = splitSpokenText("Cost is $5 (plus tax).", "$5 (plus tax).");
  assert.equal(split.match, "$5 (plus tax).");
});

test("the highlight tracks the newest matching assistant turn", () => {
  let t = applyFinal(emptyTranscript, "assistant", "Ready when you are.");
  t = applyFinal(t, "user", "again please");
  t = applyFinal(t, "assistant", "Ready when you are.");
  t = applySpeaking(t, "Ready when you are.");
  assert.equal(speakingTurnId(t), t.turns[2].id, "the reply being voiced now wins");
});

test("the highlight never lands on a user turn", () => {
  let t = applyFinal(emptyTranscript, "user", "Ready when you are.");
  t = applySpeaking(t, "Ready when you are.");
  assert.equal(speakingTurnId(t), null);
});

test("no utterance means no highlighted turn", () => {
  const t = applyFinal(emptyTranscript, "assistant", "Ready when you are.");
  assert.equal(speakingTurnId(t), null);
});
