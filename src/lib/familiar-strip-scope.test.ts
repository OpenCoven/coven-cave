// @ts-nocheck
import assert from "node:assert/strict";
import {
  DEFAULT_FAMILIAR_STRIP_SCOPE,
  FAMILIAR_STRIP_SCOPE_LABELS,
  FAMILIAR_STRIP_SCOPE_OPTIONS,
  normalizeFamiliarStripScope,
} from "./familiar-strip-scope.ts";

// The two scopes the "Avatars shown" control toggles between.
assert.deepEqual([...FAMILIAR_STRIP_SCOPE_OPTIONS], ["pinned", "all"], "exactly two scopes");
assert.equal(DEFAULT_FAMILIAR_STRIP_SCOPE, "pinned", "default surfaces only pinned familiars");

// Every option has a human label.
for (const option of FAMILIAR_STRIP_SCOPE_OPTIONS) {
  assert.equal(typeof FAMILIAR_STRIP_SCOPE_LABELS[option], "string", `label for ${option}`);
}

// normalize accepts known values and falls back to the default for anything else.
assert.equal(normalizeFamiliarStripScope("pinned"), "pinned");
assert.equal(normalizeFamiliarStripScope("all"), "all");
assert.equal(normalizeFamiliarStripScope("bogus"), DEFAULT_FAMILIAR_STRIP_SCOPE, "unknown → default");
assert.equal(normalizeFamiliarStripScope(null), DEFAULT_FAMILIAR_STRIP_SCOPE, "null → default");
assert.equal(normalizeFamiliarStripScope(undefined), DEFAULT_FAMILIAR_STRIP_SCOPE, "undefined → default");

console.log("familiar-strip-scope: all assertions passed");
