// @ts-nocheck
import assert from "node:assert/strict";
import { broadcastTargetIds } from "./terminal-broadcast.ts";

assert.deepEqual(broadcastTargetIds(["a", "b", "c"], "a"), ["b", "c"]);
assert.deepEqual(broadcastTargetIds(["a", "b", "c"], "b"), ["a", "c"]);
assert.deepEqual(broadcastTargetIds(["solo"], "solo"), [], "no targets when origin is the only pane");
assert.deepEqual(broadcastTargetIds([], "a"), []);
assert.deepEqual(broadcastTargetIds(["a", "b", "b", "c", "a"], "a"), ["b", "c"]);
assert.deepEqual(broadcastTargetIds(["a", "", "b"], "a"), ["b"]);
assert.deepEqual(broadcastTargetIds(["a", "b"], "ghost"), ["a", "b"]);

console.log("terminal-broadcast.test.ts passed");
