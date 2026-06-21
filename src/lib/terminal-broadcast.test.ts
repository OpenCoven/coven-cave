// @ts-nocheck
import assert from "node:assert/strict";
import { broadcastTargetIds, broadcastIsActionable } from "./terminal-broadcast.ts";

assert.deepEqual(broadcastTargetIds(["a", "b", "c"], "a"), ["b", "c"]);
assert.deepEqual(broadcastTargetIds(["a", "b", "c"], "b"), ["a", "c"]);
assert.deepEqual(broadcastTargetIds(["solo"], "solo"), [], "no targets when origin is the only pane");
assert.deepEqual(broadcastTargetIds([], "a"), []);
assert.deepEqual(broadcastTargetIds(["a", "b", "b", "c", "a"], "a"), ["b", "c"]);
assert.deepEqual(broadcastTargetIds(["a", "", "b"], "a"), ["b"]);
assert.deepEqual(broadcastTargetIds(["a", "b"], "ghost"), ["a", "b"]);
assert.equal(broadcastIsActionable(true, 2), true);
assert.equal(broadcastIsActionable(true, 1), false, "single pane → nothing to broadcast to");
assert.equal(broadcastIsActionable(false, 5), false, "disabled → never");
assert.equal(broadcastIsActionable(true, 0), false);

console.log("terminal-broadcast.test.ts passed");
