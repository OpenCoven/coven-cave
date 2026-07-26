// @ts-nocheck
import assert from "node:assert/strict";
const { knowledgeEntryFlags } = await import("./knowledge-flags.ts");

assert.deepEqual(
  knowledgeEntryFlags({ extra: { flags: ["contradicts opening", "timeline drift"] } }),
  ["contradicts opening", "timeline drift"],
  "string flags pass through in order",
);
assert.deepEqual(
  knowledgeEntryFlags({ extra: { flags: ["kept", 7, true, null, { issue: "object" }] } }),
  ["kept", "7", "true"],
  "primitive non-string flags stringify; nulls and objects are skipped",
);
assert.deepEqual(knowledgeEntryFlags({ extra: { flags: "nope" } }), [], "non-array flags are ignored");
assert.deepEqual(knowledgeEntryFlags({}), [], "missing extra/flags is empty");

console.log("knowledge-flags.test.ts: ok");
