// @ts-nocheck
import assert from "node:assert/strict";
import {
  diffLines,
  hasLineChanges,
  mergeThreeWay,
  CONFLICT_MARKER_MINE,
  CONFLICT_MARKER_SEP,
  CONFLICT_MARKER_THEIRS,
} from "./line-diff.ts";

// ── diffLines ────────────────────────────────────────────────────────────────

assert.deepEqual(diffLines("", ""), [], "empty vs empty has no ops");

assert.deepEqual(
  diffLines("a\nb\nc", "a\nb\nc"),
  [
    { type: "ctx", text: "a" },
    { type: "ctx", text: "b" },
    { type: "ctx", text: "c" },
  ],
  "identical text is all context",
);
assert.equal(hasLineChanges(diffLines("a\nb", "a\nb")), false, "no changes detected on identical");

assert.deepEqual(
  diffLines("a\nb\nc", "a\nB\nc"),
  [
    { type: "ctx", text: "a" },
    { type: "del", text: "b" },
    { type: "add", text: "B" },
    { type: "ctx", text: "c" },
  ],
  "a changed middle line is del+add between context",
);

assert.deepEqual(
  diffLines("a\nc", "a\nb\nc"),
  [
    { type: "ctx", text: "a" },
    { type: "add", text: "b" },
    { type: "ctx", text: "c" },
  ],
  "insertions are adds",
);

assert.deepEqual(
  diffLines("a\nb\nc", "c"),
  [
    { type: "del", text: "a" },
    { type: "del", text: "b" },
    { type: "ctx", text: "c" },
  ],
  "deletions are dels",
);

assert.deepEqual(
  diffLines("", "x\ny"),
  [
    { type: "add", text: "x" },
    { type: "add", text: "y" },
  ],
  "empty old is all adds",
);

// Trailing-newline handling: "a\n" is the line "a" plus an empty final line.
assert.equal(hasLineChanges(diffLines("a\n", "a\n")), false, "trailing newline round-trips");
assert.equal(hasLineChanges(diffLines("a", "a\n")), true, "added trailing newline is a change");

// ── mergeThreeWay: clean merges ──────────────────────────────────────────────

{
  const base = "one\ntwo\nthree\nfour";
  const mine = "ONE\ntwo\nthree\nfour"; // change at top
  const theirs = "one\ntwo\nthree\nFOUR"; // change at bottom
  const merged = mergeThreeWay(base, mine, theirs);
  assert.equal(merged.conflicts, 0, "non-overlapping edits merge cleanly");
  assert.equal(merged.text, "ONE\ntwo\nthree\nFOUR", "both sides' edits land");
}

{
  const base = "a\nb\nc";
  const merged = mergeThreeWay(base, base, base);
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.text, base, "no-op merge returns base");
}

{
  const base = "a\nb\nc";
  const mine = "a\nb\nc\nmine-tail";
  const merged = mergeThreeWay(base, mine, base);
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.text, mine, "one-sided tail insertion is kept");
}

{
  const base = "a\nb\nc";
  const both = "a\nX\nc";
  const merged = mergeThreeWay(base, both, both);
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.text, both, "identical edits on both sides merge without conflict");
}

{
  // One side deletes a line the other side left alone.
  const base = "a\nb\nc";
  const merged = mergeThreeWay(base, "a\nc", base);
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.text, "a\nc", "one-sided deletion is kept");
}

// ── mergeThreeWay: conflicts ─────────────────────────────────────────────────

{
  const base = "a\nb\nc";
  const merged = mergeThreeWay(base, "a\nMINE\nc", "a\nTHEIRS\nc");
  assert.equal(merged.conflicts, 1, "overlapping different edits conflict");
  assert.equal(
    merged.text,
    ["a", CONFLICT_MARKER_MINE, "MINE", CONFLICT_MARKER_SEP, "THEIRS", CONFLICT_MARKER_THEIRS, "c"].join("\n"),
    "conflict block carries git-style markers",
  );
}

{
  // Two separate conflicting regions are counted separately.
  const base = "a\nb\nc\nd\ne";
  const merged = mergeThreeWay(base, "a\nM1\nc\nd\nM2", "a\nT1\nc\nd\nT2");
  assert.equal(merged.conflicts, 2, "each overlapping region counts once");
}

{
  // Whole-document divergence with no stable lines.
  const merged = mergeThreeWay("base", "mine", "theirs");
  assert.equal(merged.conflicts, 1);
  assert.match(merged.text, /your draft/, "markers label the local side");
  assert.match(merged.text, /on disk/, "markers label the disk side");
}

console.log("line-diff.test: ok");
