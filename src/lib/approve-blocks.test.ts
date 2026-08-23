// @ts-nocheck
// Behavioral tests for approve blocks (cave-8k9bc) — the `<coven:approve>`
// marker protocol behind the inline questions card.
//
// The high-risk cases here are the ones a casual reading would miss:
//   - `<coven:attention …>` shares the `<coven:a` sniff prefix, so every
//     recovery path in this module can eat a sibling parser's markers.
//   - a malformed marker must never survive into the transcript as raw
//     protocol text, and must not swallow the prose or the fence after it.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_APPROVE_OPTIONS,
  MAX_APPROVE_QUESTIONS,
  MIN_APPROVE_OPTIONS,
  approveRequestKey,
  formatApproveAnswers,
  parseApproveOptions,
  sliceApproveBlocks,
  stripApproveMarkers,
  stripIncompleteApproveMarker,
} from "./approve-blocks.ts";

const marker = (attrs) => `<coven:approve kind="questions" ${attrs} />`;
const q = (prompt, options, extra = "") =>
  marker(`prompt="${prompt}" options="${options}"${extra ? ` ${extra}` : ""}`);

const approves = (pieces) => pieces.filter((p) => p.kind === "approve");
const texts = (pieces) => pieces.filter((p) => p.kind === "text").map((p) => p.text);

// ---------------------------------------------------------------- basic parse

test("extracts a single question with its options", () => {
  const pieces = sliceApproveBlocks(`Before ${q("Which auth?", "Cookies|JWT")} after`);
  const cards = approves(pieces);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].request.kind, "questions");
  assert.deepEqual(cards[0].request.questions[0].options, ["Cookies", "JWT"]);
  assert.equal(cards[0].request.questions[0].prompt, "Which auth?");
  assert.deepEqual(texts(pieces), ["Before ", " after"]);
});

test("text with no marker round-trips unchanged as a single piece", () => {
  const pieces = sliceApproveBlocks("just prose");
  assert.deepEqual(pieces, [{ kind: "text", text: "just prose" }]);
});

test("positional ids stay unique across a span; explicit id wins", () => {
  const pieces = sliceApproveBlocks(
    `${q("A", "x|y")} sep ${q("B", "x|y", 'id="picked"')} sep ${q("C", "x|y")}`,
  );
  const ids = approves(pieces).map((p) => p.request.questions[0].id);
  assert.deepEqual(ids, ["q1", "picked", "q3"]);
});

// ------------------------------------------------------------------ adjacency

test("whitespace-adjacent markers collapse into one card", () => {
  const pieces = sliceApproveBlocks(`${q("A", "x|y")}\n${q("B", "x|y")}`);
  const cards = approves(pieces);
  assert.equal(cards.length, 1);
  assert.deepEqual(
    cards[0].request.questions.map((x) => x.prompt),
    ["A", "B"],
  );
  // The whitespace merged across must not survive as a stray text piece.
  assert.deepEqual(texts(pieces), []);
});

test("prose between markers opens a separate card", () => {
  const pieces = sliceApproveBlocks(`${q("A", "x|y")} and also ${q("B", "x|y")}`);
  assert.equal(approves(pieces).length, 2);
  assert.deepEqual(texts(pieces), [" and also "]);
});

test("overflow past the cap opens a NEW card rather than dropping a question", () => {
  const run = [1, 2, 3, 4, 5].map((n) => q(`Q${n}`, "x|y")).join("\n");
  const cards = approves(sliceApproveBlocks(run));
  assert.equal(cards.length, 2);
  assert.equal(cards[0].request.questions.length, MAX_APPROVE_QUESTIONS);
  assert.equal(cards[1].request.questions.length, 2);
  // Nothing may be lost: every prompt still reaches a card.
  const seen = cards.flatMap((c) => c.request.questions.map((x) => x.prompt));
  assert.deepEqual(seen, ["Q1", "Q2", "Q3", "Q4", "Q5"]);
});

test("a rejected marker between two valid ones breaks the run", () => {
  // The middle marker has too few options, so it is dropped — and the cards on
  // either side must NOT weld together across it.
  const text = `${q("A", "x|y")}\n${q("B", "only")}\n${q("C", "x|y")}`;
  const cards = approves(sliceApproveBlocks(text));
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].request.questions.map((x) => x.prompt), ["A"]);
  assert.deepEqual(cards[1].request.questions.map((x) => x.prompt), ["C"]);
});

// -------------------------------------------------------------------- options

test("options are trimmed, de-duplicated, and capped", () => {
  assert.deepEqual(parseApproveOptions("  a |a| b  |"), ["a", "b"]);
  const many = parseApproveOptions("a|b|c|d|e|f|g|h");
  assert.equal(many.length, MAX_APPROVE_OPTIONS);
});

test("a question below the option minimum is dropped entirely", () => {
  assert.equal(MIN_APPROVE_OPTIONS, 2);
  const pieces = sliceApproveBlocks(`x ${q("A", "solo")} y`);
  assert.equal(approves(pieces).length, 0);
  // …and the tag does not leak as raw text.
  assert.equal(texts(pieces).join(""), "x  y");
});

test("duplicate options that collapse below the minimum drop the question", () => {
  const pieces = sliceApproveBlocks(q("A", "same|same"));
  assert.equal(approves(pieces).length, 0);
});

// ---------------------------------------------------------------------- other

test("free text is offered by default and opts out explicitly", () => {
  const on = approves(sliceApproveBlocks(q("A", "x|y")))[0];
  assert.equal(on.request.questions[0].allowOther, true);

  for (const optOut of ['other="no"', 'other="false"', 'other="NO"']) {
    const off = approves(sliceApproveBlocks(q("A", "x|y", optOut)))[0];
    assert.equal(off.request.questions[0].allowOther, false, optOut);
  }
  // An unrecognised value is not an opt-out — free text stays available.
  const weird = approves(sliceApproveBlocks(q("A", "x|y", 'other="maybe"')))[0];
  assert.equal(weird.request.questions[0].allowOther, true);
});

// ----------------------------------------------------------------- kind guard

test("an unknown kind is dropped, never downgraded to questions", () => {
  const text = '<coven:approve kind="command" prompt="Run it?" options="Yes|No" />';
  const pieces = sliceApproveBlocks(text);
  assert.equal(approves(pieces).length, 0);
  assert.equal(texts(pieces).join("").includes("coven:approve"), false);
});

test("a missing kind is dropped", () => {
  const pieces = sliceApproveBlocks('<coven:approve prompt="A" options="x|y" />');
  assert.equal(approves(pieces).length, 0);
});

// ------------------------------------------------------------------ malformed

test("a duplicate attribute fails closed and drops the marker", () => {
  const text = '<coven:approve kind="questions" prompt="A" prompt="B" options="x|y" />';
  const pieces = sliceApproveBlocks(text);
  assert.equal(approves(pieces).length, 0);
  assert.equal(texts(pieces).join("").includes("coven:approve"), false);
});

test("a malformed marker is removed without leaking a raw tag or eating prose", () => {
  const pieces = sliceApproveBlocks('start <coven:approve kind=questions> tail');
  assert.equal(approves(pieces).length, 0);
  const joined = texts(pieces).join("");
  assert.equal(joined.includes("<coven:approve"), false);
  assert.equal(joined.includes("tail"), true);
});

test("a malformed marker does not hide a later valid one", () => {
  const text = `<coven:approve" busted> ${q("A", "x|y")}`;
  const cards = approves(sliceApproveBlocks(text));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].request.questions[0].prompt, "A");
});

test("a closing tag is stripped (the protocol is self-closing)", () => {
  const pieces = sliceApproveBlocks(`${q("A", "x|y")}</coven:approve>`);
  assert.equal(approves(pieces).length, 1);
  assert.equal(texts(pieces).join("").includes("coven:approve"), false);
});

// ------------------------------------------------- sibling parser (COLLISION)

test("attention markers survive every approve path untouched", () => {
  // `<coven:attention …>` shares the `<coven:a` sniff prefix. If any recovery
  // path here claims it, the sidebar attention signal silently disappears.
  const attention = '<coven:attention reason="needs a human" />';

  const pieces = sliceApproveBlocks(`${attention} then ${q("A", "x|y")}`);
  assert.equal(approves(pieces).length, 1);
  assert.equal(texts(pieces).join("").includes(attention), true);

  assert.equal(stripApproveMarkers(attention), attention);
  assert.equal(stripIncompleteApproveMarker(attention), attention);
});

test("an incomplete attention tail is left for its own parser", () => {
  const tail = 'text <coven:attention reason="hal';
  assert.equal(stripIncompleteApproveMarker(tail), tail);
});

// ------------------------------------------------------------------- streaming

test("an incomplete approve tail is hidden while streaming", () => {
  assert.equal(stripIncompleteApproveMarker('text <coven:approve kind="ques'), "text ");
  assert.equal(stripIncompleteApproveMarker("text <coven:app"), "text ");
});

test("a complete marker survives stripIncomplete but not stripApproveMarkers", () => {
  const text = `a ${q("A", "x|y")} b`;
  assert.equal(stripIncompleteApproveMarker(text), text);
  assert.equal(stripApproveMarkers(text), "a  b");
});

test("the settled slicer also hides an incomplete tail", () => {
  const pieces = sliceApproveBlocks(`${q("A", "x|y")} then <coven:approve kind="que`);
  assert.equal(approves(pieces).length, 1);
  assert.equal(texts(pieces).join("").includes("<coven:approve"), false);
});

// ----------------------------------------------------------------- code fences

test("a fenced marker stays literal example text", () => {
  const text = ["Use it like:", "```", q("A", "x|y"), "```"].join("\n");
  const pieces = sliceApproveBlocks(text);
  assert.equal(approves(pieces).length, 0);
  assert.equal(texts(pieces).join("").includes("<coven:approve"), true);
});

test("inline code keeps a marker literal", () => {
  const text = `write \`${q("A", "x|y")}\` to ask`;
  assert.equal(approves(sliceApproveBlocks(text)).length, 0);
});

test("a malformed marker before a fence does not consume the fence", () => {
  const text = ["<coven:approve kind=busted", "```", q("A", "x|y"), "```"].join("\n");
  const pieces = sliceApproveBlocks(text);
  assert.equal(approves(pieces).length, 0, "the fenced example must not become a card");
  const joined = texts(pieces).join("");
  // Assert on the example's OWN content. Asserting on ``` alone is not a guard:
  // the closing delimiter survives even when recovery eats the opening fence
  // and everything between, because the malformed marker's recovery boundary
  // is the `>` of the fenced marker itself.
  assert.equal(joined.includes('prompt="A"'), true, "the fenced example must survive");
  assert.equal(joined.includes("```"), true, "the fence itself must survive");
  assert.equal(joined.includes("kind=busted"), false, "the malformed tag must not leak");
});

test("stripApproveMarkers leaves fenced examples alone", () => {
  const text = ["```", q("A", "x|y"), "```"].join("\n");
  assert.equal(stripApproveMarkers(text), text);
});

// ------------------------------------------------------------- prompt content

test("a `>` inside a prompt does not close the tag early", () => {
  const pieces = sliceApproveBlocks(q("Use a > b?", "Yes|No"));
  const cards = approves(pieces);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].request.questions[0].prompt, "Use a > b?");
  assert.equal(texts(pieces).join(""), "");
});

test("an empty prompt drops the question", () => {
  assert.equal(approves(sliceApproveBlocks(q("   ", "x|y"))).length, 0);
});

// ----------------------------------------------------------------- formatting

test("answers format one line per question and omit the unanswered", () => {
  const request = approves(sliceApproveBlocks(`${q("A", "x|y")}\n${q("B", "p|r")}`))[0]
    .request;
  assert.equal(formatApproveAnswers(request, { q1: "x" }), "A → x");
  assert.equal(formatApproveAnswers(request, { q1: "x", q2: "r" }), "A → x\nB → r");
  assert.equal(formatApproveAnswers(request, {}), "");
  // A blank answer is not an answer.
  assert.equal(formatApproveAnswers(request, { q1: "   " }), "");
});

test("the card key distinguishes different question sets", () => {
  const a = approves(sliceApproveBlocks(q("A", "x|y")))[0].request;
  const b = approves(sliceApproveBlocks(q("B", "x|y")))[0].request;
  assert.notEqual(approveRequestKey(a), approveRequestKey(b));
  assert.equal(typeof approveRequestKey(a), "string");
});
