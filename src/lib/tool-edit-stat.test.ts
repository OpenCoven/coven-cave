// @ts-nocheck
import assert from "node:assert/strict";
const { diffStat } = await import("./tool-edit-stat.ts");
const diff = ["@@ -1,2 +1,3 @@", " ctx", "-old line", "+new line", "+extra line"].join("\n");
assert.deepEqual(diffStat(diff), { insertions: 2, deletions: 1 }, "counts +/- non-header lines");
assert.deepEqual(diffStat(""), { insertions: 0, deletions: 0 }, "empty diff is zero");
assert.deepEqual(diffStat("+++ b/x\n--- a/x\n+real"), { insertions: 1, deletions: 0 }, "ignores +++/--- file headers");
console.log("tool-edit-stat ok");
