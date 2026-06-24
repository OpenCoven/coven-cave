import assert from "node:assert/strict";
import { test } from "node:test";

import { fuzzyMatch, fuzzyScore, bestFuzzyScore } from "./fuzzy-match.ts";

test("fuzzyMatch: subsequence + substring + case-insensitive", () => {
  assert.equal(fuzzyMatch("brd", "Board"), true, "abbreviation/subsequence matches");
  assert.equal(fuzzyMatch("board", "Board"), true, "substring matches");
  assert.equal(fuzzyMatch("BOARD", "board"), true, "case-insensitive");
  assert.equal(fuzzyMatch("gtcal", "Go to Calendar"), true, "spanning word-initials match");
  assert.equal(fuzzyMatch("", "anything"), true, "empty query matches everything");
});

test("fuzzyMatch: rejects out-of-order / missing chars", () => {
  assert.equal(fuzzyMatch("drb", "Board"), false, "wrong order does not match");
  assert.equal(fuzzyMatch("xyz", "Board"), false, "missing chars do not match");
  assert.equal(fuzzyMatch("boardx", "Board"), false, "extra trailing char fails");
});

test("fuzzyScore: substring outranks scattered subsequence", () => {
  const sub = fuzzyScore("board", "Board: Kanban")!;
  const scattered = fuzzyScore("board", "Browse old archived records daily")!;
  assert.ok(sub !== null && scattered !== null);
  assert.ok(sub > scattered, "a literal 'board' beats a scattered b-o-a-r-d");
});

test("fuzzyScore: word-boundary and earlier matches score higher", () => {
  assert.ok(
    fuzzyScore("cal", "Calendar")! > fuzzyScore("cal", "Vertical scale")!,
    "start-of-string beats mid-word",
  );
  assert.ok(
    fuzzyScore("set", "Settings")! > fuzzyScore("set", "Reset offset")!,
    "earlier substring scores higher",
  );
});

test("fuzzyScore: null when no match, 0 for empty query", () => {
  assert.equal(fuzzyScore("zzz", "Board"), null);
  assert.equal(fuzzyScore("", "Board"), 0);
});

test("bestFuzzyScore: takes the best across candidate fields (ignores nullish)", () => {
  const s = bestFuzzyScore("board", ["Open project", null, "Board: Table", undefined]);
  assert.equal(s, fuzzyScore("board", "Board: Table"));
  assert.equal(bestFuzzyScore("zzz", ["Board", null]), null, "no field matches → null");
});

console.log("fuzzy-match.test.ts: ok");
