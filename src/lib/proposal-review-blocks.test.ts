// Behavioral tests for the proposal-review receipt marker protocol
// (<coven:proposal-review>), mirroring auto-status-blocks.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PROPOSAL_REVIEW_ANSWERS,
  normalizeProposalReviewVerdict,
  parseProposalReviewAnswers,
  proposalReviewKey,
  sliceProposalReviewBlocks,
} from "./proposal-review-blocks.ts";

const MARKER =
  '<coven:proposal-review tool="propose_patch" target="src/x.ts" verdict="proposal_only" reviewer="jev-1.13.0" q="addresses_task:yes:0.93|evidence_supports:yes:0.91|unrelated_changes:no:0.96|needs_clarification:yes:0.88" reason="needs clarification" />';

test("slice: the issue's marker becomes one review piece with prose on both sides", () => {
  const pieces = sliceProposalReviewBlocks(`Here is the patch.\n${MARKER}\nLet me know.`);
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces[0], { kind: "text", text: "Here is the patch.\n" });
  assert.deepEqual(pieces[2], { kind: "text", text: "\nLet me know." });
  const piece = pieces[1];
  assert.equal(piece.kind, "proposal-review");
  if (piece.kind !== "proposal-review") return;
  assert.deepEqual(piece.review, {
    tool: "propose_patch",
    target: "src/x.ts",
    verdict: "proposal_only",
    reviewer: "jev-1.13.0",
    reason: "needs clarification",
    answers: [
      { id: "addresses_task", answer: "yes", confidence: 0.93 },
      { id: "evidence_supports", answer: "yes", confidence: 0.91 },
      { id: "unrelated_changes", answer: "no", confidence: 0.96 },
      { id: "needs_clarification", answer: "yes", confidence: 0.88 },
    ],
  });
});

test("slice: no raw marker text ever survives into a text piece", () => {
  const pieces = sliceProposalReviewBlocks(`a ${MARKER} b`);
  for (const piece of pieces) {
    if (piece.kind === "text") assert.ok(!piece.text.includes("<coven:proposal-review"));
  }
});

test("verdict: the four known verdicts pass; anything else renders as unavailable", () => {
  for (const verdict of ["permit", "proposal_only", "reject", "unavailable"]) {
    assert.equal(normalizeProposalReviewVerdict(verdict), verdict);
  }
  assert.equal(normalizeProposalReviewVerdict("PERMIT"), "permit", "case-insensitive");
  assert.equal(normalizeProposalReviewVerdict("proposal-only"), "proposal_only", "dash spelling accepted");
  for (const unknown of ["approved", "maybe", "", undefined]) {
    assert.equal(normalizeProposalReviewVerdict(unknown), "unavailable", `"${unknown}" is unavailable`);
  }
  const piece = sliceProposalReviewBlocks(
    '<coven:proposal-review tool="run_command" verdict="allow" q="addresses_task:yes:0.5" />',
  )[0];
  assert.equal(piece.kind, "proposal-review");
  if (piece.kind === "proposal-review") assert.equal(piece.review.verdict, "unavailable");
});

test("answers: triples parse, malformed entries are skipped, and at most six survive", () => {
  assert.deepEqual(parseProposalReviewAnswers("a:yes:0.5|b:no|c:maybe:1|d:x:1.5|:yes:0.2|e::0.1|f:yes:nope"), [
    { id: "a", answer: "yes", confidence: 0.5 },
    { id: "b", answer: "no", confidence: null },
    { id: "c", answer: "maybe", confidence: 1 },
  ]);
  const many = Array.from({ length: 9 }, (_, index) => `q${index}:yes:0.9`).join("|");
  assert.equal(parseProposalReviewAnswers(many).length, MAX_PROPOSAL_REVIEW_ANSWERS);
});

test("slice: a marker without a tool or without any valid answer is dropped silently", () => {
  const pieces = sliceProposalReviewBlocks(
    'a <coven:proposal-review verdict="permit" q="addresses_task:yes:0.9" /> b <coven:proposal-review tool="x" q="nope" /> c',
  );
  assert.deepEqual(pieces, [{ kind: "text", text: "a " }, { kind: "text", text: " b " }, { kind: "text", text: " c" }]);
});

test("slice: a partial trailing marker stays hidden until the stream completes it", () => {
  const pieces = sliceProposalReviewBlocks('Reviewing.\n<coven:proposal-review tool="propose_patch" verdict="per');
  assert.deepEqual(pieces, [{ kind: "text", text: "Reviewing.\n" }]);
});

test("slice: a terminated but unparseable marker is dropped, and prose after it survives", () => {
  const pieces = sliceProposalReviewBlocks('x <coven:proposal-review tool=propose_patch> y');
  assert.deepEqual(pieces, [{ kind: "text", text: "x " }, { kind: "text", text: " y" }]);
});

test("slice: fenced markers stay literal example text", () => {
  const text = ["Example:", "```", MARKER, "```", "Done."].join("\n");
  const pieces = sliceProposalReviewBlocks(text);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].kind, "text");
  assert.ok(pieces[0].kind === "text" && pieces[0].text.includes("<coven:proposal-review"));
});

test("slice: a > inside a quoted attribute does not end the marker early", () => {
  const pieces = sliceProposalReviewBlocks(
    '<coven:proposal-review tool="propose_patch" reason="a > b" q="addresses_task:yes:0.7" /> tail',
  );
  assert.equal(pieces[0].kind, "proposal-review");
  if (pieces[0].kind === "proposal-review") assert.equal(pieces[0].review.reason, "a > b");
  assert.deepEqual(pieces[1], { kind: "text", text: " tail" });
});

test("slice: a backtick inside an attribute cannot hide a later card", () => {
  const first = '<coven:proposal-review tool="run_`cmd`" q="addresses_task:yes:0.7" />';
  const second = '<coven:proposal-review tool="propose_patch" verdict="reject" q="addresses_task:no:0.9" />';
  const pieces = sliceProposalReviewBlocks(`${first} mid ${second}`);
  assert.deepEqual(pieces.map((piece) => piece.kind), ["proposal-review", "text", "proposal-review"]);
});

test("slice: plain text and empty input round-trip", () => {
  assert.deepEqual(sliceProposalReviewBlocks("just prose"), [{ kind: "text", text: "just prose" }]);
  assert.deepEqual(sliceProposalReviewBlocks(""), []);
});

test("key: identity covers every rendered field", () => {
  const [a] = sliceProposalReviewBlocks(MARKER);
  const [b] = sliceProposalReviewBlocks(MARKER.replace('verdict="proposal_only"', 'verdict="permit"'));
  assert.ok(a.kind === "proposal-review" && b.kind === "proposal-review");
  if (a.kind !== "proposal-review" || b.kind !== "proposal-review") return;
  assert.notEqual(proposalReviewKey(a.review), proposalReviewKey(b.review));
  assert.equal(proposalReviewKey(a.review), proposalReviewKey(sliceProposalReviewBlocks(MARKER)[0].kind === "proposal-review" ? (sliceProposalReviewBlocks(MARKER)[0] as { review: typeof a.review }).review : a.review));
});
