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
  /onPatch\(card\.id, \{[\s\S]{0,180}projectId: selectedProject\?\.id \?\? null,[\s\S]{0,180}cwd: selectedProject\?\.root \?\? null,[\s\S]{0,180}familiarId: null,[\s\S]{0,180}sessionId: null,[\s\S]{0,180}\}\)/,
  "changing the inspector project picker clears the old familiar and session before persisting the new project root",
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
assert.ok(
  inspector.indexOf('label="Project"') < inspector.indexOf('label="Familiar"'),
  "inspector presents Project before Familiar",
);
assert.match(
  inspector,
  /useProjectFamiliars\(\{ projectId: card\.projectId \?\? null \}\)/,
  "inspector requests only project-authorized familiars",
);
assert.match(
  inspector,
  /value=\{familiarPickerReady \? card\.familiarId \?\? "" : ""\}[\s\S]{0,700}disabled=\{!familiarPickerReady\}/,
  "inspector disables the familiar choice until its project authorization result is ready",
);
assert.match(
  inspector,
  /const familiarPickerReady = !card\.projectId \|\| \(eligibleFamiliarsLoaded && !eligibleFamiliarsLoading\)/,
  "inspector keeps the familiar picker available for unscoped cards",
);
assert.match(
  inspector,
  /const familiarOptions = !card\.projectId[\s\S]{0,360}\.{3}familiars\.map\(\(familiar\)/,
  "inspector preserves the complete familiar roster for unscoped cards",
);
assert.match(
  inspector,
  /!eligibleFamiliars\.some\([\s\S]{0,500}onPatch\(card\.id, \{ familiarId: null, sessionId: null \}\)/,
  "inspector clears an existing familiar and its stale session when it is ineligible for the selected project",
);
assert.match(
  inspector,
  /label="Familiar"[\s\S]{0,700}onChange=\{\(next\) => \{[\s\S]{0,500}familiarId: next \|\| null,[\s\S]{0,150}sessionId: null,[\s\S]{0,150}\.\.\.taskModelPatch\(null\)/,
  "changing an authorized familiar unlinks its prior runtime session and model",
);

// ── New-card modal can set a project at creation time ──────────────────────
assert.match(newCard, /projectId: string \| null;/, "NewCardDraft carries projectId");
assert.match(
  newCard,
  /useProjects\(\{ enabled: open \}\)/,
  "new-card modal loads the project list before choosing a familiar",
);
assert.match(newCard, /setProjectId\(null\)/, "new-card modal resets projectId when reopened");
assert.match(
  newCard,
  /useProjectFamiliars\(\{ projectId, enabled: open \}\)/,
  "new-card modal fetches familiar options scoped to its selected project",
);
assert.match(
  newCard,
  /!eligibleFamiliars\.some\([\s\S]{0,180}setFamiliarId\(null\);[\s\S]{0,100}setSessionId\(null\);/,
  "new-card modal clears an incompatible familiar and linked session after a project change",
);
assert.ok(
  newCard.indexOf('<Field label="Project">') < newCard.indexOf('<Field label="Familiar">'),
  "new-card modal presents Project before Familiar",
);
assert.match(
  newCard,
  /value=\{familiarPickerReady \? familiarId \?\? "" : ""\}[\s\S]{0,200}disabled=\{!familiarPickerReady\}/,
  "new-card modal gates project-backed familiar choices on authorization",
);
assert.match(
  newCard,
  /onChange=\{\(v\) => \{[\s\S]{0,700}setProjectId\(v \|\| null\);[\s\S]{0,180}setFamiliarId\(null\);[\s\S]{0,180}setSessionId\(null\);/,
  "changing a new task's project immediately clears the prior familiar while its authorized roster loads",
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
