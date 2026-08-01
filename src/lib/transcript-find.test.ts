import assert from "node:assert/strict";
import test from "node:test";

import {
  findMatchingTurnIds,
  findOccurrences,
  findTranscriptHits,
  normalizeFindText,
  type FindableTurn,
} from "./transcript-find.ts";

const turns: FindableTurn[] = [
  { id: "t1", role: "user", text: "Deploy the cave to staging" },
  { id: "t2", role: "assistant", text: "Deploying now. deploy deploy." },
  { id: "t3", role: "assistant", text: "Nothing to see here" },
];

// ── normalization ───────────────────────────────────────────────────────────

test("normalization collapses whitespace so offsets match what is displayed", () => {
  assert.equal(normalizeFindText("a\n\n  b\tc "), "a b c");
  assert.equal(normalizeFindText("   "), "");
});

test("a query spanning collapsed whitespace still matches", () => {
  const hits = findTranscriptHits([{ id: "t", text: "hello\n   world" }], "hello world");
  assert.equal(hits.length, 1, "the newline run normalizes to the single space in the query");
  assert.equal(hits[0].snippet.slice(hits[0].snippetStart, hits[0].snippetEnd), "hello world");
});

// ── occurrence counting ─────────────────────────────────────────────────────

test("every occurrence is reported, in reading order", () => {
  const hits = findTranscriptHits(turns, "deploy");
  assert.deepEqual(
    hits.map((h) => [h.turnId, h.occurrenceInTurn]),
    [["t1", 1], ["t2", 1], ["t2", 2], ["t2", 3]],
    "t2 holds three occurrences and each gets its own row",
  );
  assert.equal(hits[1].occurrencesInTurn, 3, "rows know their turn's total");
  assert.deepEqual(hits.map((h) => h.turnIndex), [0, 1, 1, 1]);
});

test("turn ids stay one-per-turn — a jump lands on a turn, not an offset", () => {
  assert.deepEqual(findMatchingTurnIds(turns, "deploy"), ["t1", "t2"]);
});

test("overlapping candidates count the way editors count them", () => {
  // "aa" in "aaa" is two occurrences (0-2, then scan resumes at 2), not three.
  assert.equal(findOccurrences("aaa", "aa").length, 1);
  assert.equal(findOccurrences("aaaa", "aa").length, 2);
});

test("a blank or whitespace query matches nothing", () => {
  for (const q of ["", "   ", "\n\t"]) {
    assert.deepEqual(findTranscriptHits(turns, q), [], `blank query ${JSON.stringify(q)}`);
    assert.deepEqual(findMatchingTurnIds(turns, q), []);
  }
});

// ── match case ──────────────────────────────────────────────────────────────

test("case-insensitive by default, exact with matchCase", () => {
  assert.equal(findTranscriptHits(turns, "DEPLOY").length, 4);
  assert.equal(findTranscriptHits(turns, "DEPLOY", { matchCase: true }).length, 0);
  assert.equal(findTranscriptHits(turns, "Deploy", { matchCase: true }).length, 2, "t1 + t2 leading caps");
  assert.equal(findTranscriptHits(turns, "deploy", { matchCase: true }).length, 2, "the two lowercase ones");
});

// This is the reason the fold is length-preserving. "İ".toLowerCase() is TWO
// code units, so a naive fold shifts every offset after it and the highlight
// lands on the wrong characters.
test("a character whose lowercase changes length never corrupts a hit's offsets", () => {
  const text = "İİİ needle here";
  const [hit] = findTranscriptHits([{ id: "t", text }], "needle");
  assert.ok(hit, "the hit is found after the awkward characters");
  assert.equal(
    hit.snippet.slice(hit.snippetStart, hit.snippetEnd),
    "needle",
    "the highlighted span is exactly the query, not shifted",
  );
});

// ── whole word ──────────────────────────────────────────────────────────────

test("whole word rejects hits glued to letters, digits or underscores", () => {
  const t = [{ id: "t", text: "cat cats concat cat_1 cat. (cat) cat9" }];
  const loose = findTranscriptHits(t, "cat");
  const strict = findTranscriptHits(t, "cat", { wholeWord: true });
  assert.equal(loose.length, 7, "substring mode sees every occurrence");
  assert.equal(strict.length, 3, "only the standalone cat, cat. and (cat)");
  assert.deepEqual(
    strict.map((h) => h.snippetStart),
    [0, 22, 28],
    "the survivors are the ones bounded by space, period and parenthesis",
  );
});

test("whole word respects unicode letters, not just ASCII", () => {
  // A naive \b would treat é as a boundary and wrongly match inside "café".
  const t = [{ id: "t", text: "café cafés" }];
  assert.equal(findTranscriptHits(t, "café", { wholeWord: true }).length, 1);
  assert.equal(findTranscriptHits(t, "caf", { wholeWord: true }).length, 0);
});

test("whole word matches at the very start and end of a turn", () => {
  const t = [{ id: "t", text: "cat" }];
  assert.equal(findTranscriptHits(t, "cat", { wholeWord: true }).length, 1);
});

// ── regex-shaped queries are literals, not patterns ─────────────────────────

test("a query full of regex metacharacters is treated literally", () => {
  const t = [{ id: "t", text: "call foo(a.*b) then done" }];
  assert.equal(findTranscriptHits(t, "foo(a.*b)").length, 1, "matches the literal text");
  assert.equal(findTranscriptHits(t, "a.*b").length, 1);
  assert.equal(findTranscriptHits([{ id: "t", text: "aXXb" }], "a.*b").length, 0, "not a pattern");
  // A pathological pattern must not hang: this is why there is no RegExp here.
  assert.equal(findTranscriptHits([{ id: "t", text: "a".repeat(5000) }], "(a+)+$").length, 0);
});

// ── snippets ────────────────────────────────────────────────────────────────

test("a short turn shows in full with no ellipsis", () => {
  const [hit] = findTranscriptHits([{ id: "t", text: "short and sweet" }], "sweet");
  assert.equal(hit.snippet, "short and sweet");
  assert.equal(hit.ellipsisStart, false);
  assert.equal(hit.ellipsisEnd, false);
  assert.equal(hit.snippet.slice(hit.snippetStart, hit.snippetEnd), "sweet");
});

test("a long turn is windowed around the hit and marked as clipped", () => {
  const text = `${"x".repeat(400)} needle ${"y".repeat(400)}`;
  const [hit] = findTranscriptHits([{ id: "t", text }], "needle");
  assert.ok(hit.snippet.length <= 96, `snippet stays within budget (${hit.snippet.length})`);
  assert.equal(hit.ellipsisStart, true);
  assert.equal(hit.ellipsisEnd, true);
  assert.equal(
    hit.snippet.slice(hit.snippetStart, hit.snippetEnd),
    "needle",
    "the window is anchored so the hit is inside it",
  );
});

test("a hit at the very start of a long turn keeps its left edge", () => {
  const [hit] = findTranscriptHits([{ id: "t", text: `needle ${"y".repeat(400)}` }], "needle");
  assert.equal(hit.ellipsisStart, false, "nothing was cut before the hit");
  assert.equal(hit.snippetStart, 0);
  assert.equal(hit.snippet.slice(hit.snippetStart, hit.snippetEnd), "needle");
});

test("a hit at the very end of a long turn keeps its right edge", () => {
  const [hit] = findTranscriptHits([{ id: "t", text: `${"y".repeat(400)} needle` }], "needle");
  assert.equal(hit.ellipsisEnd, false, "nothing was cut after the hit");
  assert.equal(hit.snippet.slice(hit.snippetStart, hit.snippetEnd), "needle");
});

test("a hit longer than the snippet window is still anchored at its start", () => {
  const long = "z".repeat(300);
  const [hit] = findTranscriptHits([{ id: "t", text: `lead ${long} tail` }], long);
  assert.equal(hit.snippetStart, hit.snippet.indexOf("z"), "the window starts at the hit");
  assert.ok(hit.snippetEnd <= hit.snippet.length, "the end offset stays inside the snippet");
  assert.ok(hit.snippet.slice(hit.snippetStart, hit.snippetEnd).length > 0);
});

// Every hit must be renderable: slicing by its own offsets has to stay inside
// its own snippet, or the band would highlight past the end of the row.
test("every hit's offsets are inside its own snippet", () => {
  const corpus: FindableTurn[] = [
    { id: "a", text: "needle" },
    { id: "b", text: `${"x".repeat(500)}needle${"y".repeat(500)}` },
    { id: "c", text: `needle${"y".repeat(500)}` },
    { id: "d", text: `${"x".repeat(500)}needle` },
    { id: "e", text: "needle needle needle" },
    { id: "f", text: `${"x".repeat(50)} needle ${"y".repeat(50)}` },
  ];
  for (const hit of findTranscriptHits(corpus, "needle")) {
    assert.ok(hit.snippetStart >= 0, `${hit.turnId}: start >= 0`);
    assert.ok(hit.snippetEnd <= hit.snippet.length, `${hit.turnId}: end within snippet`);
    assert.ok(hit.snippetStart <= hit.snippetEnd, `${hit.turnId}: start <= end`);
    assert.equal(
      hit.snippet.slice(hit.snippetStart, hit.snippetEnd),
      "needle",
      `${hit.turnId}: the highlighted span is the query`,
    );
  }
});

// ── roles ───────────────────────────────────────────────────────────────────

test("hits carry the role so a row can name who said it", () => {
  const hits = findTranscriptHits(turns, "deploy");
  assert.equal(hits[0].role, "user");
  assert.equal(hits[1].role, "assistant");
  assert.equal(findTranscriptHits([{ id: "x", text: "hi" }], "hi")[0].role, "assistant", "defaults");
});

console.log("transcript-find.test.ts: ok");
