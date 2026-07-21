import assert from "node:assert/strict";

import { accessSummary, bulkGrantOps, nextSelectAll } from "./access-grants.ts";

// Bulk grant skips already-granted familiars and the supreme familiar.
assert.deepEqual(
  bulkGrantOps(["a", "b", "c", "supreme"], new Set(["b"]), "supreme", "grant"),
  [
    { familiarId: "a", next: true },
    { familiarId: "c", next: true },
  ],
);

// Bulk revoke only touches familiars that actually hold a grant.
assert.deepEqual(
  bulkGrantOps(["a", "b", "supreme"], new Set(["b", "supreme"]), "supreme", "revoke"),
  [{ familiarId: "b", next: false }],
);

// Nothing selected → nothing to do.
assert.deepEqual(bulkGrantOps([], new Set(["a"]), null, "revoke"), []);

// Summary strings: none / plain / with the always-on supreme familiar.
assert.equal(accessSummary(0, 0), "None granted");
assert.equal(accessSummary(3, 0), "3 granted");
assert.equal(accessSummary(2, 1), "3 granted · 1 always");

// Select-all toggles between everything-selectable and clear.
assert.deepEqual([...nextSelectAll(["a", "b"], new Set())], ["a", "b"]);
assert.deepEqual([...nextSelectAll(["a", "b"], new Set(["a"]))], ["a", "b"]);
assert.deepEqual([...nextSelectAll(["a", "b"], new Set(["a", "b"]))], []);
assert.deepEqual([...nextSelectAll([], new Set())], []);

console.log("access-grants.test.ts: ok");
