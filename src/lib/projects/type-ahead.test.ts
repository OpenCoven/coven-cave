import assert from "node:assert/strict";

import { nextTypeAheadIndex } from "./type-ahead.ts";

const labels = ["Alpha", "Beta", "berry", "Cherry", "apple"];

// Empty inputs → no match.
assert.equal(nextTypeAheadIndex([], 0, "a"), -1);
assert.equal(nextTypeAheadIndex(labels, 0, ""), -1);

// Single letter: jump to the next item starting with it (case-insensitive),
// strictly after the current index.
assert.equal(nextTypeAheadIndex(labels, 0, "b"), 1, "from Alpha, 'b' → Beta");
assert.equal(nextTypeAheadIndex(labels, 1, "b"), 2, "from Beta, 'b' → berry (cycle)");
assert.equal(nextTypeAheadIndex(labels, 2, "b"), 1, "from berry, 'b' → wraps back to Beta");
assert.equal(nextTypeAheadIndex(labels, 0, "c"), 3, "'c' → Cherry");

// Repeated same char ("aa") behaves like the single-letter cycle.
assert.equal(nextTypeAheadIndex(labels, 0, "aa"), 4, "from Alpha, 'aa' → apple (next a)");
assert.equal(nextTypeAheadIndex(labels, 4, "a"), 0, "from apple, 'a' → wraps to Alpha");

// Multi-letter distinct buffer: prefix match starting AT current (refine in place).
assert.equal(nextTypeAheadIndex(labels, 1, "be"), 1, "from Beta, 'be' stays on Beta");
assert.equal(nextTypeAheadIndex(labels, 1, "ber"), 2, "'ber' → berry");
assert.equal(nextTypeAheadIndex(labels, 0, "che"), 3, "'che' → Cherry");
assert.equal(nextTypeAheadIndex(labels, 0, "zz"), -1, "no prefix match → -1");

// Current index out of range is treated as 0.
assert.equal(nextTypeAheadIndex(labels, -1, "c"), 3);
// Clamped to 0, then the single-letter cycle advances PAST index 0 → apple (4).
assert.equal(nextTypeAheadIndex(labels, 99, "a"), 4);

console.log("type-ahead.test.ts: ok");
