import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildChatContinuityChapters, chatContinuityWindow, hasValidChatContinuityLineage, utcChapterDay } from "./chat-continuity-chapters.ts";
import { resolveActivePath } from "./conversation-tree.ts";

test("chapters preserve immutable canonical order, equal timestamps and stable scoped anchors", () => {
  const turns = Object.freeze([
    Object.freeze({ id: "z", createdAt: "2026-09-09T00:00:00Z", text: "original" }),
    Object.freeze({ id: "a", createdAt: "2026-09-09T00:00:00Z", text: "unchanged" }),
    Object.freeze({ id: "older", createdAt: "2026-09-08T12:00:00Z" }),
    Object.freeze({ id: "return", createdAt: "2026-09-09T01:00:00Z" }),
  ] as const);
  const index = buildChatContinuityChapters("chat", turns, true);
  assert.equal(index.status, "partial");
  assert.deepEqual(index.chapters.map((c) => [c.firstTurnId, c.turnCount]), [["z", 2], ["older", 1], ["return", 1]]);
  assert.deepEqual(index.chapters.map((chapter) => chapter.lastTurnId), ["a", "older", "return"]);
  assert.equal(index.chapters[0].id, JSON.stringify(["utc-day-v1", "chat", "z"]));
  assert.equal(buildChatContinuityChapters("chat", [...turns, { id: "new", createdAt: "2026-09-10T00:00:00Z" }], true).chapters[0].id, index.chapters[0].id);
  assert.notEqual(buildChatContinuityChapters("other", turns, true).chapters[0].id, index.chapters[0].id);
  assert.equal(turns[0].text, "original");
  const extended = buildChatContinuityChapters("chat", [...turns, { id: "tail", createdAt: "2026-09-09T02:00:00Z" }], true);
  assert.equal(extended.chapters[2].id, index.chapters[2].id);
  assert.equal(extended.chapters[2].lastTurnId, "tail");
  assert.equal(index.chapters[2].lastTurnId, "return");
});

test("strict UTC accepts only canonical Z seconds or three millisecond digits", () => {
  assert.equal(utcChapterDay("2024-02-29T12:00:00Z"), "2024-02-29");
  assert.equal(utcChapterDay("2024-02-29T12:00:00.123Z"), "2024-02-29");
  assert.equal(utcChapterDay("2024-02-29T12:00:00.000Z"), "2024-02-29");
  assert.equal(utcChapterDay(undefined), null);
  assert.equal(utcChapterDay(42 as unknown as string), null);
  for (const date of [
    "", "yesterday", "2026-09-09", "2026-09-09T12:00:00",
    "2026-02-29T12:00:00Z", "2026-04-31T12:00:00Z", "2026-09-09T24:00:00Z",
    "2026-09-09T12:00:00+25:00", "2026-09-09T12:00:00+00:00",
    "2026-09-09T00:30:00+02:00", "2026-09-08T23:30:00-02:00",
    "2024-02-29T12:00:00.1Z", "2024-02-29T12:00:00.12Z",
    "2024-02-29T12:00:00.1234Z", "2024-02-29T12:00:00.123456Z",
    "2026-09-09T12:00:60Z", "2026-09-09t12:00:00Z", "2026-09-09T12:00:00z",
    "2026-09-09T12:00:00Z\n",
  ]) {
    assert.equal(utcChapterDay(date), null, date);
    const turns = Object.freeze([Object.freeze({ id: "invalid", createdAt: date })]);
    assert.equal(buildChatContinuityChapters("chat", turns, false).status, "unavailable", date);
    assert.equal(turns[0].createdAt, date);
  }
});

test("the resolved active branch, not raw storage or timestamp order, owns chapter order", () => {
  const turns = [
    { id: "leaf", parentId: "middle", createdAt: "2026-09-08T00:00:00Z" },
    { id: "sibling", parentId: "root", createdAt: "2026-08-01T00:00:00Z" },
    { id: "root", parentId: null, createdAt: "2026-09-09T00:00:00Z" },
    { id: "middle", parentId: "root", createdAt: "2026-09-09T00:00:00Z" },
  ];
  const before = JSON.stringify(turns);
  const index = buildChatContinuityChapters("chat", resolveActivePath(turns, "leaf"), false);
  assert.deepEqual(index.chapters.map((chapter) => chapter.firstTurnId), ["root", "leaf"]);
  assert.equal(JSON.stringify(turns), before);
});

test("empty, invalid dates and duplicate identities fail the index, never rewrite the transcript", () => {
  for (const turns of [[], [{ id: "a", createdAt: "" }], [{ id: "a", createdAt: "2026-09-09T00:00:00Z" }, { id: "a", createdAt: "2026-09-10T00:00:00Z" }]]) {
    assert.equal(buildChatContinuityChapters("chat", turns, false).status, "unavailable");
    assert.deepEqual(buildChatContinuityChapters("chat", turns, false).chapters, []);
  }
});

test("malformed active lineages cannot certify truncated or recovered chapter anchors", () => {
  const valid = [
    { id: "user", parentId: null, role: "user", createdAt: "2026-09-06T12:00:00Z" },
    { id: "system", parentId: "user", role: "system", createdAt: "2026-09-07T12:00:00Z" },
    { id: "reply", parentId: "system", role: "assistant", createdAt: "2026-09-08T12:00:00Z" },
    { id: "echo", parentId: null, role: "system", createdAt: "2026-09-07T13:00:00Z" },
  ];
  assert.equal(hasValidChatContinuityLineage(valid, "reply"), true);
  assert.equal(hasValidChatContinuityLineage(valid, ""), false, "linked history needs an authoritative leaf");
  assert.equal(hasValidChatContinuityLineage(valid.map((turn) => ({ ...turn, parentId: null })), ""), true);
  for (const [label, turns, leaf] of [
    ["missing leaf", valid, "removed"],
    ["missing system ancestor", valid.filter((turn) => turn.id !== "system"), "reply"],
    ["missing parent", valid.map((turn) => turn.id === "system" ? { ...turn, parentId: "gone" } : turn), "reply"],
    ["cycle through system", valid.map((turn) => turn.id === "system" ? { ...turn, parentId: "reply" } : turn), "reply"],
    ["self cycle", valid.map((turn) => turn.id === "reply" ? { ...turn, parentId: "reply" } : turn), "reply"],
    ["duplicate identity", [...valid, valid[0]], "reply"],
    ["non-string parent", valid.map((turn) => turn.id === "system" ? { ...turn, parentId: 42 as unknown as string } : turn), "reply"],
  ] as const) {
    const before = JSON.stringify(turns);
    assert.equal(hasValidChatContinuityLineage(turns, leaf), false, label);
    const readablePath = resolveActivePath([...turns], leaf);
    assert.ok(readablePath.length > 0, "existing transcript recovery remains accessible");
    const index = buildChatContinuityChapters("exact",
      hasValidChatContinuityLineage(turns, leaf) ? readablePath : [], true);
    assert.deepEqual(index, { status: "unavailable", chapters: [] }, label);
    assert.equal(JSON.stringify(turns), before);
  }
});

test("large single-day input produces one chapter without copying accumulated turns", () => {
  const turns = Array.from({ length: 50_000 }, (_, i) => ({ id: String(i), createdAt: "2026-09-09T00:00:00Z" }));
  const index = buildChatContinuityChapters("large", turns, false);
  assert.equal(index.status, "complete");
  assert.equal(index.chapters[0].turnCount, turns.length);
});

test("bounded source windows stay fixed during append and never recover a missing anchor as latest", () => {
  assert.deepEqual(chatContinuityWindow(100_000, null, 60), { start: 99_940, end: 100_000 });
  assert.deepEqual(chatContinuityWindow(100_000, 970, 60), { start: 970, end: 1030 });
  assert.deepEqual(chatContinuityWindow(100_002, 970, 60), { start: 970, end: 1030 });
  assert.deepEqual(chatContinuityWindow(100_000, -1, 60), { start: 0, end: 0 });
  assert.deepEqual(chatContinuityWindow(12, 0, 60), { start: 0, end: 12 });
  assert.deepEqual(chatContinuityWindow(0, null, 60), { start: 0, end: 0 });
  for (let start = 0; start < 100_000; start += 60) {
    const window = chatContinuityWindow(100_000, start, 60);
    assert.ok(window.end - window.start <= 60);
    assert.equal(window.start, start);
  }
});

type GoldenVector = {
  id: string;
  conversationId: string;
  turns: { id: string; createdAt: string }[];
  expected?: { id: string; date: string; firstTurnId: string; lastTurnId: string; turnCount: number }[];
  expectedError?: string;
};
const golden: { cases: GoldenVector[] } = JSON.parse(readFileSync(
  new URL("../../docs/fixtures/familiar-continuity-v1.json", import.meta.url), "utf8",
));
for (const vector of golden.cases) {
  test(`parent golden vector: ${vector.id}`, () => {
    const before = JSON.stringify(vector.turns);
    const actual = buildChatContinuityChapters(vector.conversationId, vector.turns, false);
    if (vector.expectedError) {
      assert.equal(actual.status, "unavailable");
      assert.deepEqual(actual.chapters, []);
    } else {
      assert.equal(actual.status, vector.turns.length === 0 ? "unavailable" : "complete");
      assert.deepEqual(actual.chapters.map(({ id, day, firstTurnId, lastTurnId, turnCount }) => ({
        id, date: day, firstTurnId, lastTurnId, turnCount,
      })), vector.expected);
    }
    assert.equal(JSON.stringify(vector.turns), before);
  });
}
