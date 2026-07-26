// The Craft create drawer has two familiar selects with different
// contracts: describe mode dispatches an agentic build brief that ANY
// familiar can take (roles not required — a fresh summon like kitty must be
// offerable), while extract mode bundles existing roles and rightly lists
// only familiars that have some. These pins hold that split (regression:
// the describe dropdown used to be roles-derived, hiding roleless
// familiars entirely).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const drawer = await readFile(new URL("./craft-create-drawer.tsx", import.meta.url), "utf8");

// Roster load: the full familiar list arrives from /api/familiars while the
// drawer is open, and a failed fetch degrades to roles-derived options
// instead of erroring the drawer.
assert.match(
  drawer,
  /fetch\("\/api\/familiars", \{ cache: "no-store", signal: ctl\.signal \}\)/,
  "the drawer loads the full familiar roster",
);
assert.match(
  drawer,
  /json\.familiars\.map\(\(f\) => f\.id\)\.filter\(\(id\): id is string => Boolean\(id\)\)/,
  "roster ids are extracted defensively",
);
assert.match(
  drawer,
  /Roster is an enrichment; describe mode falls back to roles-derived/,
  "a failed roster fetch is tolerated, not surfaced as a drawer error",
);

// Describe options = union(roster, roles familiars), so the list is never
// SMALLER than the extract list even when the roster fetch failed.
assert.match(
  drawer,
  /new Set\(\[\.\.\.rosterIds, \.\.\.roles\.map\(\(role\) => role\.familiar\)\]\)/,
  "describe options union the roster with roles-derived familiars",
);
assert.match(
  drawer,
  /options=\{\[\{ value: "", label: "Let the familiar decide" \}, \.\.\.describeFamiliarOptions\]\}/,
  "the describe-mode preferred-familiar select offers the full roster",
);

// Extract mode must stay roles-derived: there is nothing to extract from a
// familiar with no roles (its dead-end is the teaching state, not an option).
assert.match(
  drawer,
  /options=\{familiarOptions\}/,
  "the extract-mode familiar select stays roles-derived",
);
assert.match(
  drawer,
  /No roles found for this familiar\. Roles are defined in the familiar studio/,
  "a roleless familiar in extract mode lands on the teaching state",
);
