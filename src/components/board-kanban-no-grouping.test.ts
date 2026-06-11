// @ts-nocheck
// Kanban is the canonical status-column board: the Status/Familiar group
// toggle only applies to the table view, and the kanban surface always
// receives status grouping regardless of the persisted table preference.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");

assert.match(
  view,
  /\{!isMobile && viewMode === "table" \? \(\s*<div className="board-group-toggle"/,
  "group toggle renders only for the desktop table view",
);
assert.match(
  view,
  /<BoardKanban[\s\S]*?groupBy="status"/,
  "kanban always groups by status columns",
);
assert.doesNotMatch(
  view,
  /<BoardKanban[\s\S]{0,150}groupBy=\{groupBy\}/,
  "kanban must not inherit the table grouping preference",
);

console.log("board-kanban-no-grouping.test.ts OK");
