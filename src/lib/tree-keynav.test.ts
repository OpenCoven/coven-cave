// @ts-nocheck
import assert from "node:assert/strict";
import { nextVisibleIndex, parentIndexByDepth } from "./tree-keynav.ts";

// nextVisibleIndex
assert.equal(nextVisibleIndex("ArrowDown", 0, 5), 1);
assert.equal(nextVisibleIndex("ArrowDown", 4, 5), 4, "clamps at last");
assert.equal(nextVisibleIndex("ArrowUp", 3, 5), 2);
assert.equal(nextVisibleIndex("ArrowUp", 0, 5), 0, "clamps at first");
assert.equal(nextVisibleIndex("Home", 3, 5), 0);
assert.equal(nextVisibleIndex("End", 1, 5), 4);
assert.equal(nextVisibleIndex("ArrowRight", 1, 5), null, "non-linear key");
assert.equal(nextVisibleIndex("ArrowDown", 0, 0), null, "empty");

// parentIndexByDepth — depths for: a(0) > b(1) > c(2), d(1), e(0)
const depths = [0, 1, 2, 1, 0];
assert.equal(parentIndexByDepth(depths, 2), 1, "c's parent is b");
assert.equal(parentIndexByDepth(depths, 3), 0, "d's parent is a (nearest shallower before it)");
assert.equal(parentIndexByDepth(depths, 1), 0, "b's parent is a");
assert.equal(parentIndexByDepth(depths, 4), null, "e is top-level, no parent");
assert.equal(parentIndexByDepth(depths, 0), null, "first row, no parent");
assert.equal(parentIndexByDepth(depths, 9), null, "out of range");
// siblings at same depth don't count as parent
assert.equal(parentIndexByDepth([0, 1, 1, 1], 3), 0, "skips same-depth siblings to the real parent");

console.log("tree-keynav.test.ts passed");
