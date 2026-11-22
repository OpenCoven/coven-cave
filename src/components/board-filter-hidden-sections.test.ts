// @ts-nocheck
//
// Guard (#6561): a status excluded in the Tasks Filter menu is not drawn.
// tests/board-filter-hides-sections.spec.ts proves the Kanban columns in a
// browser; these source assertions cover keyboard moves and the phone stack.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [board, kanban, stack] = await Promise.all([
  read("./board-view.tsx"),
  read("./board-kanban.tsx"),
  read("./board-card-stack.tsx"),
]);

// Board hands its Filter exclusions to both status views.
assert.match(board, /<BoardKanban cards=\{filtered\}[^\n]*\n\s*hiddenStatuses=\{excludedStatus\}/, "Kanban receives the excluded statuses");
assert.match(board, /<BoardCardStack cards=\{filtered\}[^\n]*\n\s*hiddenStatuses=\{excludedStatus\}/, "the card stack receives the excluded statuses");

// Kanban draws and walks only visible columns.
assert.match(kanban, /const visibleColumns = useMemo\(\s*\(\) => \(hiddenStatuses\?\.size \? COLUMNS\.filter\(\(col\) => !hiddenStatuses\.has\(col\.id\)\) : COLUMNS\)/, "visible columns exclude filtered statuses");
assert.match(kanban, /\{visibleColumns\.map\(\(col\) => \{/, "every swimlane renders only visible columns");
assert.doesNotMatch(kanban, /\{COLUMNS\.map\(\(col\) => \{/, "no swimlane renders the fixed column list");
assert.match(kanban, /visibleColumns\.findIndex\(\(c\) => c\.id === id\)/, "keyboard moves index visible columns");
assert.match(kanban, /Math\.min\(visibleColumns\.length - 1, currentIdx \+ delta\)/, "keyboard moves stop at the last visible column");
assert.match(kanban, /const nextCol = visibleColumns\[nextIdx\];/, "keyboard moves land on a visible column");

// The phone stack drops excluded sections and tabs, and a tab that becomes
// excluded falls back to All instead of an empty list.
assert.match(stack, /const visibleSections = useMemo\(\s*\(\) => \(hiddenStatuses\?\.size \? SECTIONS\.filter\(\(s\) => !hiddenStatuses\.has\(s\.id\)\) : SECTIONS\)/, "visible sections exclude filtered statuses");
assert.match(stack, /\.\.\.visibleSections\.map\(\(s\) => \(\{ id: s\.id, label: s\.label, count: counts\[s\.id\] \}\)\)/, "tabs list only visible sections");
assert.match(stack, /return visibleSections\s*\.filter\(\(s\) => filter === "all" \|\| filter === s\.id\)/, "sections list only visible statuses");
assert.match(stack, /selectedFilter !== "all" && hiddenStatuses\?\.has\(selectedFilter\) \? "all" : selectedFilter/, "an excluded selected tab falls back to All");
// Moving a card can still target any status; the card then leaves the view.
assert.match(stack, /<PopoverLabel>Move to<\/PopoverLabel>\s*\{SECTIONS\.map/, "Move to keeps every status");
