import assert from "node:assert/strict";
import { computeMdDocStats, formatMdDocStats } from "./md-doc-stats.ts";

assert.deepEqual(computeMdDocStats(""), { words: 0, chars: 0, tokens: 0 });
assert.deepEqual(computeMdDocStats("   \n  "), { words: 0, chars: 6, tokens: 2 });
{
  const s = computeMdDocStats("one two  three\nfour");
  assert.equal(s.words, 4);
  assert.equal(s.chars, 19);
  assert.equal(s.tokens, Math.ceil(19 / 4));
}
assert.equal(formatMdDocStats({ words: 1, chars: 1, tokens: 1 }), "1 word · 1 char · ~1 tokens");
assert.equal(
  formatMdDocStats(computeMdDocStats("hello world")),
  "2 words · 11 chars · ~3 tokens",
);
// Locale grouping for large docs.
assert.match(formatMdDocStats({ words: 1200, chars: 6800, tokens: 1700 }), /1,200 words · 6,800 chars · ~1,700 tokens/);

console.log("md-doc-stats.test: ok");
