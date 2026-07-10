// @ts-nocheck
// Project grouping (PR #755) buckets cards by `card.projectId`, but the value
// was only ever auto-derived from cwd — there was no UI to assign it. The card
// inspector and the new-card modal now expose a Project picker so users can set
// (or clear) a card's project explicitly. The board POST/PATCH API already
// accepts `projectId`, so this is pure UI wiring threaded through board-view.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inspector = readFileSync(new URL("./board-inspector.tsx", import.meta.url), "utf8");
const newCard = readFileSync(new URL("./new-card-modal.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");

// ── Inspector exposes an editable Project picker ───────────────────────────
assert.match(inspector, /projects: CaveProject\[\];/, "inspector Props declares a projects list");
assert.match(
  inspector,
  /value=\{card\.projectId \?\? ""\}/,
  "inspector project select is bound to the card's projectId (empty when unset)",
);
assert.match(
  inspector,
  /onPatch\(card\.id, \{ projectId: selectedProject\?\.id \?\? null, cwd: selectedProject\?\.root \?\? null \}\)/,
  "changing the inspector project picker patches projectId and its persisted cwd",
);
assert.match(inspector, /\{ value: "", label: "No project" \}/, "inspector offers a No-project option");
assert.match(
  inspector,
  /projects\.map\(\(project\) => \(\{ value: project\.id, label: project\.name \}\)\)/,
  "inspector lists every known project by id/name",
);
assert.match(
  inspector,
  /Open Projects/,
  "inspector offers a direct route to the project creation surface",
);

// ── New-card modal can set a project at creation time ──────────────────────
assert.match(newCard, /projectId: string \| null;/, "NewCardDraft carries projectId");
// The modal sources its own familiar-scoped project list (rather than taking an
// unscoped `projects` prop) so the Project picker only offers projects the
// assigned familiar has been granted — matching the server-side grant filter.
assert.match(
  newCard,
  /useProjects\(\{ familiarId, enabled: open \}\)/,
  "new-card modal scopes its project list to the selected familiar",
);
assert.match(newCard, /setProjectId\(null\)/, "new-card modal resets projectId when reopened");
assert.match(
  newCard,
  /setFamiliarId\(v \|\| null\);[\s\S]{0,400}setProjectId\(null\);/,
  "switching the familiar clears the selected project so an ungranted project can't ride along the re-scope",
);
assert.match(
  newCard,
  /<Field label="Project">[\s\S]{0,260}options=\{\[\s*\{ value: "", label: "No project" \},/,
  "new-card modal renders a Project field with a No-project default",
);
assert.match(
  newCard,
  /onCreate\(\{[\s\S]{0,200}projectId,/,
  "the created draft includes the selected projectId",
);

// ── board-view threads the projects list into both surfaces ────────────────
assert.match(
  view,
  /<BoardInspector[\s\S]{0,600}projects=\{projects\}/,
  "board-view passes projects to the inspector",
);
// The new-card modal now self-scopes to the assigned familiar, so board-view no
// longer threads its unscoped project list into it (the inspector still gets it).
assert.doesNotMatch(
  view,
  /<NewCardModal[\s\S]{0,200}projects=\{projects\}/,
  "board-view must not pass the unscoped project list to the new-card modal",
);

console.log("board-project-picker.test.ts OK");
