import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_TURN_GAP_MIN_MS, chatTurnGapLabel } from "./chat-turn-gap.ts";

const base = Date.parse("2026-08-05T12:00:00.000Z");
const at = (ms: number) => new Date(base + ms).toISOString();

test("short pauses get no divider", () => {
  assert.equal(chatTurnGapLabel(at(0), at(0)), null);
  assert.equal(chatTurnGapLabel(at(0), at(9 * 60_000)), null, "9 minutes is thinking time");
  assert.equal(
    chatTurnGapLabel(at(0), at(CHAT_TURN_GAP_MIN_MS - 1)),
    null,
    "the threshold is exclusive below",
  );
});

test("the threshold agrees with the timestamp reveal the transcript already uses", () => {
  assert.equal(CHAT_TURN_GAP_MIN_MS, 10 * 60 * 1000);
  assert.equal(chatTurnGapLabel(at(0), at(CHAT_TURN_GAP_MIN_MS)), "10 minutes later");
});

test("labels round to the unit a reader acts on", () => {
  // #5954: the divider says when the next turn came, in words ("5 hours
  // later"), not an abbreviation ("5 HR GAP").
  assert.equal(chatTurnGapLabel(at(0), at(18 * 60_000)), "18 minutes later");
  assert.equal(chatTurnGapLabel(at(0), at(59 * 60_000)), "59 minutes later");
  // 2h47m reads as "3 hours" — the divider's job is the shape of the pause,
  // and spending its width on minutes nobody acts on is what the rounding avoids.
  assert.equal(chatTurnGapLabel(at(0), at(167 * 60_000)), "3 hours later");
  assert.equal(chatTurnGapLabel(at(0), at(60 * 60_000)), "1 hour later");
  assert.equal(chatTurnGapLabel(at(0), at(23 * 3_600_000)), "23 hours later");
  assert.equal(chatTurnGapLabel(at(0), at(25 * 3_600_000)), "1 day later");
  assert.equal(chatTurnGapLabel(at(0), at(72 * 3_600_000)), "3 days later");
});

test("missing, unparseable or backwards timestamps produce no divider", () => {
  assert.equal(chatTurnGapLabel(null, at(3_600_000)), null);
  assert.equal(chatTurnGapLabel(at(0), undefined), null);
  assert.equal(chatTurnGapLabel("not-a-date", at(3_600_000)), null);
  assert.equal(chatTurnGapLabel(at(0), "not-a-date"), null);
  // An out-of-order transcript must not claim a negative pause.
  assert.equal(chatTurnGapLabel(at(3_600_000), at(0)), null);
});
