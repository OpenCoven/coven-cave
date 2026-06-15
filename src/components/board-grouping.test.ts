// @ts-nocheck
// Tasks can be grouped by Status, Familiar, or Project across BOTH the kanban
// and table surfaces. Status grouping keeps the canonical status columns;
// Familiar/Project grouping render swimlanes (kanban) and grouped rows (table).
// The group toggle is shared by both views — kanban no longer hard-pins status.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");
const table = readFileSync(new URL("./board-table.tsx", import.meta.url), "utf8");
const kanban = readFileSync(new URL("./board-kanban.tsx", import.meta.url), "utf8");

// ── Shared toggle drives both views ────────────────────────────────────────
assert.match(
  view,
  /const showGroupToggle = !isMobile;/,
  "the group toggle is shown for both desktop views (kanban + table), not only the table",
);
assert.match(
  view,
  /\{showGroupToggle \? \(\s*<div className="board-group-toggle"/,
  "group toggle visibility should be centralized behind showGroupToggle",
);
assert.match(
  view,
  /onClick=\{\(\) => setGroupBy\("project"\)\}/,
  "the toggle offers a Project grouping option",
);

// ── Kanban inherits the effective grouping (no longer pinned to status) ─────
assert.match(
  view,
  /<BoardKanban[\s\S]{0,200}groupBy=\{effectiveGroupBy\}/,
  "kanban receives the effective grouping so Project/Familiar render as swimlanes",
);
assert.doesNotMatch(
  view,
  /<BoardKanban[\s\S]{0,150}groupBy="status"/,
  "kanban must not hard-pin status grouping anymore",
);

// ── Both view components receive the projects list ─────────────────────────
assert.match(view, /<BoardKanban[\s\S]{0,200}projects=\{projects\}/, "kanban gets projects for lane labels");
assert.match(view, /<BoardTable[\s\S]{0,200}projects=\{projects\}/, "table gets projects for group labels");

// ── Grouping logic in both surfaces understands "project" ──────────────────
for (const [name, src] of [["board-table.tsx", table], ["board-kanban.tsx", kanban]]) {
  assert.match(src, /c\.projectId \?\? NO_PROJECT_KEY/, `${name} buckets cards by projectId with a No-project fallback`);
  assert.match(src, /No project/, `${name} labels the unassigned-project bucket "No project"`);
}

console.log("board-grouping.test.ts OK");
