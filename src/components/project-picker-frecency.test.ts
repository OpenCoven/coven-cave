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
  /\{displayedProjects\.map\(\(entry\) => renderProjectRow\(entry, entry\.id\)\)\}/,
  "and is rendered from the alphabetical list, not from a ranked one",
);
assert.doesNotMatch(
  picker,
  /visible[\s\S]{0,80}rankProjectsByFrecency/,
  "frecency must never feed the main list",
);
// Three sections now, in this order: Recent, then the active familiar's pinned
// projects, then the full list (cave-fh9so). A character-budget between the
// first and last heading only held while they were adjacent, so this asserts
// the ORDER — which is the thing that matters — via the index of each label.
for (const [earlier, later] of [
  ["<PopoverLabel>Recent</PopoverLabel>", "'s projects`}</PopoverLabel>"],
  ["'s projects`}</PopoverLabel>", "<PopoverLabel>All projects</PopoverLabel>"],
] as const) {
  const a = picker.indexOf(earlier);
  const b = picker.indexOf(later);
  assert.ok(a !== -1, `missing section heading: ${earlier}`);
  assert.ok(b !== -1, `missing section heading: ${later}`);
  assert.ok(a < b, `${earlier} must come before ${later}`);
}

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
  3,
  "and every section calls it — Recent, the familiar's pinned projects, and All",
);

assert.match(
  picker,
  /const PROJECT_PREVIEW_SIZE = 8;/,
  "the unfiltered alphabetical list has a compact initial budget",
);
assert.match(
  picker,
  /if \(query\.trim\(\) \|\| showAllProjects \|\| visible\.length <= PROJECT_PREVIEW_SIZE\) \{\s*return visible;/,
  "filtering searches and renders the complete matching project set",
);
assert.match(
  picker,
  /if \(selected && !preview\.some\(\(project\) => project\.id === selected\.id\)\) \{\s*return \[\.\.\.preview, selected\];/,
  "the selected project remains visible even when it falls outside the preview",
);
assert.match(
  picker,
  /`Show \$\{hiddenProjectCount\} more project\$\{hiddenProjectCount === 1 \? "" : "s"\}`/,
  "the bounded list exposes the remaining project count",
);
assert.match(
  picker,
  /key="project-list-toggle"[\s\S]*setShowAllProjects\(\(current\) => !current\)[\s\S]*Show fewer projects/,
  "the expansion control remains mounted as a collapse control so keyboard focus is preserved",
);

console.log("project-picker-frecency.test.ts: ok");
