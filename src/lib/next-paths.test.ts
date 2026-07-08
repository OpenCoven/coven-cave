// @ts-nocheck
import assert from "node:assert/strict";
import { buildNextPathsDirective, extractNextPaths, DEFAULT_NEXT_PATHS_COUNT } from "./next-paths.ts";

// directive: default asks for 2 or 4 (never 3), respects count, empty when 0
assert.equal(DEFAULT_NEXT_PATHS_COUNT, 4);
assert.match(buildNextPathsDirective(), /append 2 or 4 short/);
assert.match(buildNextPathsDirective(), /never exactly 3/);
assert.match(buildNextPathsDirective(3), /<coven:next-paths>/);
assert.match(buildNextPathsDirective(2), /up to 2 short/);
assert.equal(buildNextPathsDirective(0), "");

// no block -> unchanged
{
  const r = extractNextPaths("Just an answer.");
  assert.equal(r.visible, "Just an answer.");
  assert.deepEqual(r.suggestions, []);
}
// full block -> stripped + parsed
{
  const t = "Here is the answer.\n\n<coven:next-paths>\n- Run the tests\n- Open a PR\n- Summarize changes\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Here is the answer.");
  assert.deepEqual(r.suggestions, ["Run the tests", "Open a PR", "Summarize changes"]);
}
// streaming (open, no close yet) -> hidden, partial parsed
{
  const t = "Answer.\n<coven:next-paths>\n- Run the tests\n- Open a";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Answer.");
  assert.deepEqual(r.suggestions, ["Run the tests", "Open a"]);
}
console.log("next-paths.test.ts: ok");
