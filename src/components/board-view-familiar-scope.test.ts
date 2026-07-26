// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");

// The filtered memo must hard-scope to the active familiar — switching
// familiars should re-scope the board the same way ChatList does for chats.
assert.match(
  source,
  /activeFamiliarId === null \|\| c\.familiarId === activeFamiliarId/,
  "BoardView must filter cards by activeFamiliarId (null allowed as a defensive escape hatch)",
);

assert.match(
  source,
  /\[cards, familiarsById, searchQuery, activeFamiliarId, scopeFamiliarIds, deletePending, excludedStatus, excludedProject, projectLabelOf\]/,
  "BoardView filtered memo deps include activeFamiliarId + scopeFamiliarIds (and deletePending for the undo-window hide, plus the redesign's excludedStatus/excludedProject/projectLabelOf filter deps) so re-filter triggers on familiar switch / multiselect change / filter toggle",
);

// Multiselect: when a scope set is supplied, the board filters to the union via
// the shared familiarInScope predicate (empty set = All).
assert.match(
  source,
  /scopeFamiliarIds\s*\?\s*familiarInScope\(scopeFamiliarIds, c\.familiarId\)/,
  "BoardView filters by the multiselect scope set when provided",
);

// The header stats object these pins guarded was dead code (computed every
// render, rendered nowhere — its board-header-stats CSS was orphaned too) and
// was removed in the 2026-07-02 board audit. Keep it gone.
assert.doesNotMatch(
  source,
  /const stats = useMemo/,
  "the unused BoardView stats memo must not return",
);

assert.match(
  source,
  /const effectiveGroupBy: GroupBy = activeFamiliarId !== null && groupBy === "familiar" \? "status" : groupBy;/,
  "Scoping to one familiar should drop the redundant familiar grouping back to status (project grouping stays usable)",
);

assert.match(
  source,
  /<BoardTable[\s\S]{0,180}groupBy=\{effectiveGroupBy\}/,
  "BoardTable should receive the effective scoped grouping",
);

console.log("board-view-familiar-scope.test.ts: ok");
