import assert from "node:assert/strict";

import {
  PROJECTS_DENSITY_KEY,
  PROJECTS_EXPANDED_KEY,
  normalizeDensity,
  parseExpandedIds,
  serializeExpandedIds,
  toggleExpandedId,
} from "./projects-ui-state.ts";

// Stable storage keys (changing these silently drops everyone's saved state).
assert.equal(PROJECTS_EXPANDED_KEY, "cave:projects:expanded");
assert.equal(PROJECTS_DENSITY_KEY, "cave:projects:density");

// parseExpandedIds: clean array out, junk tolerated.
assert.deepEqual(parseExpandedIds(JSON.stringify(["a", "b"])), ["a", "b"]);
assert.deepEqual(parseExpandedIds(null), []);
assert.deepEqual(parseExpandedIds(undefined), []);
assert.deepEqual(parseExpandedIds("not json"), []);
assert.deepEqual(parseExpandedIds(JSON.stringify({ a: 1 })), []);
assert.deepEqual(parseExpandedIds(JSON.stringify(["a", 2, null, "b"])), ["a", "b"]);

// round-trip
assert.deepEqual(parseExpandedIds(serializeExpandedIds(["x", "y", "x"])), ["x", "y"]);

// toggleExpandedId: add / remove / idempotent
assert.deepEqual(toggleExpandedId(["a"], "b", true), ["a", "b"]);
assert.deepEqual(toggleExpandedId(["a", "b"], "a", false), ["b"]);
assert.deepEqual(toggleExpandedId(["a"], "a", true), ["a"], "adding an existing id is a no-op");
assert.deepEqual(toggleExpandedId(["a"], "b", false), ["a"], "removing an absent id is a no-op");

// normalizeDensity: only "compact" is special; everything else is comfortable.
assert.equal(normalizeDensity("compact"), "compact");
assert.equal(normalizeDensity("comfortable"), "comfortable");
assert.equal(normalizeDensity(null), "comfortable");
assert.equal(normalizeDensity("garbage"), "comfortable");

console.log("projects-ui-state.test.ts: ok");
