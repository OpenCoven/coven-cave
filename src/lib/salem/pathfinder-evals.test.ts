// @ts-nocheck
import assert from "node:assert/strict";
import evals from "./pathfinder-evals.json" with { type: "json" };
import { matchPath } from "./pathfinder-match.ts";
import { getPath } from "./happy-paths.ts";

// Regression: every canonical intent must still map to its path. This is the
// seed eval set — local feedback corrections can be promoted into it over time.
assert.ok(Array.isArray(evals.cases) && evals.cases.length >= 5, "has eval cases");

let pass = 0;
for (const c of evals.cases) {
  assert.ok(getPath(c.expected), `${c.expected} is a real registry path`);
  const r = matchPath({ mode: c.mode, userMessage: c.message });
  assert.equal(r.pathId, c.expected, `"${c.message}" (${c.mode}) → ${c.expected}, got ${r.pathId}`);
  pass += 1;
}

console.log(`pathfinder-evals.test.ts OK (${pass} cases)`);
