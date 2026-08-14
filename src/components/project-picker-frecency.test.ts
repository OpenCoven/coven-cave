// @ts-nocheck
// Wiring pins for frecency in the project picker (cave-ow9f). The scoring and
// store behaviour is covered behaviourally in src/lib/project-frecency.test.ts;
// this pins how the picker uses it, because the design tradeoff lives here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const picker = readFileSync(fileURLToPath(new URL("./project-picker.tsx", import.meta.url)), "utf8");

// ── the additive contract ───────────────────────────────────────────────────
// The whole point of a pinned section is that the list a user has learned does
// not move. If the A-Z list ever gets re-sorted by score, the feature has
// become the thing the bead warned against.
assert.match(
  picker,
  /const sortedProjects = useMemo\(\(\) => sortProjectsAlphabetically\(projects\), \[projects\]\)/,
  "the full list is still ordered alphabetically",
);
assert.match(
  picker,
  /\{visible\.map\(\(entry\) => renderProjectRow\(entry, entry\.id\)\)\}/,
  "and is rendered from the alphabetical list, not from a ranked one",
);
assert.doesNotMatch(
  picker,
  /visible[\s\S]{0,80}rankProjectsByFrecency/,
  "frecency must never feed the main list",
);
assert.match(
  picker,
  /<PopoverLabel>Recent<\/PopoverLabel>[\s\S]{0,200}<PopoverLabel>All projects<\/PopoverLabel>/,
  "the Recent section is labelled and the full list keeps its own heading",
);

// ── when the section appears ────────────────────────────────────────────────
assert.match(
  picker,
  /if \(!open \|\| query\.trim\(\)\) return \[\];/,
  "no Recent section while filtering — a query is already the narrower answer",
);
assert.match(
  picker,
  /\}, \[open, sortedProjects, query\]\);/,
  "the section is sampled on the open edge so it cannot reshuffle mid-interaction",
);
assert.match(picker, /recent\.length > 0 \? \(/, "an empty history renders no section at all");

// ── picking records ─────────────────────────────────────────────────────────
assert.match(
  picker,
  /const pick = \(project: \{ id: string; root: string \}\) => \{\s*rememberProjectPick\(project\.root\);\s*onChange\(project\.id\);/,
  "selecting a project records the pick before propagating the change",
);
assert.match(
  picker,
  /onSelect=\{\(\) => pick\(entry\)\}/,
  "both sections go through the same recording path",
);
// Typing a name and pressing Enter is a pick too — routing it around pick()
// meant frecency never learned from keyboard selection (PR #4142 review).
assert.match(
  picker,
  /const match = projectForPickerQuery\(sortedProjects, query\);\s*if \(!match\) return;[\s\S]{0,200}?pick\(match\);/,
  "the filter input's Enter path records the pick as well",
);
assert.doesNotMatch(
  picker,
  /if \(!match\) return;\s*onChange\(match\.id\);/,
  "Enter must not bypass pick() straight to onChange",
);
// One renderer for both sections: a divergence here is how the Recent rows
// silently stop recording, or lose the access/selected affordances.
assert.equal(
  (picker.match(/const renderProjectRow = \(/g) ?? []).length,
  1,
  "exactly one row renderer is defined",
);
assert.equal(
  (picker.match(/renderProjectRow\(entry,/g) ?? []).length,
  2,
  "and both sections call it — Recent and All",
);

console.log("project-picker-frecency.test.ts: ok");
