// @ts-nocheck
import assert from "node:assert/strict";
import { computeDockInlineCount } from "./familiar-dock-overflow.ts";

// Wide container: everything fits inline, no overflow.
assert.equal(
  computeDockInlineCount({ containerWidth: 400, itemWidth: 40, reservedWidth: 100, total: 5 }),
  5,
  "wide container shows all familiars inline",
);

// Narrow container: only a subset fits; rest overflow.
// available = 200 - 100 = 100 → floor(100/40) = 2
assert.equal(
  computeDockInlineCount({ containerWidth: 200, itemWidth: 40, reservedWidth: 100, total: 5 }),
  2,
  "narrow container clamps to what fits",
);

// Exact fit shows all (no spurious overflow).
assert.equal(
  computeDockInlineCount({ containerWidth: 260, itemWidth: 40, reservedWidth: 100, total: 4 }),
  4,
  "exact fit shows all four",
);

// No familiars → zero.
assert.equal(
  computeDockInlineCount({ containerWidth: 400, itemWidth: 40, reservedWidth: 100, total: 0 }),
  0,
  "no familiars yields zero inline",
);

// Degenerate width (unmeasured / 0) never returns negative.
assert.equal(
  computeDockInlineCount({ containerWidth: 0, itemWidth: 40, reservedWidth: 100, total: 5 }),
  0,
  "unmeasured container yields zero, never negative",
);

console.log("familiar-dock-overflow.test.ts OK");
