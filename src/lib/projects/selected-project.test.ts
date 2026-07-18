// Unit tests for the Projects hub's pure selection helpers. Relative import so
// the strip-types runner needs no alias loader (mirrors project-stats.test.ts).
import assert from "node:assert/strict";

import {
  PROJECTS_SELECTED_KEY,
  defaultSelectedProjectId,
  parseStoredProjectId,
  resolveSelectedProjectId,
} from "./selected-project.ts";

assert.equal(PROJECTS_SELECTED_KEY, "cave:projects:selected");

// ── parseStoredProjectId ─────────────────────────────────────────────────────
assert.equal(parseStoredProjectId(null), null);
assert.equal(parseStoredProjectId(undefined), null);
assert.equal(parseStoredProjectId(""), null);
assert.equal(parseStoredProjectId("   "), null, "whitespace-only is junk");
assert.equal(parseStoredProjectId(" abc123 "), "abc123", "ids are trimmed");

// ── defaultSelectedProjectId ─────────────────────────────────────────────────
const projects = [
  { id: "alpha", rootKey: "/repo/alpha" },
  { id: "beta", rootKey: "/repo/beta" },
  { id: "gamma", rootKey: "/repo/gamma" },
];

assert.equal(defaultSelectedProjectId([], new Map()), null, "no projects → null");
assert.equal(
  defaultSelectedProjectId(projects, new Map()),
  "alpha",
  "no activity anywhere → first (alphabetical) project",
);
assert.equal(
  defaultSelectedProjectId(
    projects,
    new Map([
      ["/repo/beta", 200],
      ["/repo/gamma", 900],
      ["/repo/alpha", 400],
    ]),
  ),
  "gamma",
  "the most recently active project wins",
);
assert.equal(
  defaultSelectedProjectId(projects, new Map([["/repo/unknown", 999]])),
  "alpha",
  "activity under an unregistered root doesn't select anything",
);

// ── resolveSelectedProjectId ─────────────────────────────────────────────────
const activity = new Map([["/repo/beta", 500]]);
assert.equal(
  resolveSelectedProjectId("gamma", projects, activity),
  "gamma",
  "a stored id that still exists wins over the default",
);
assert.equal(
  resolveSelectedProjectId("deleted-id", projects, activity),
  "beta",
  "a stale stored id falls back to the activity default",
);
assert.equal(
  resolveSelectedProjectId(null, projects, activity),
  "beta",
  "no stored id → activity default",
);
assert.equal(resolveSelectedProjectId("anything", [], new Map()), null, "no projects → null");

console.log("selected-project.test.ts: ok");
