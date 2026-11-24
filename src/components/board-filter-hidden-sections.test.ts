// @ts-nocheck
//
// Guard (#6561): a section unchecked in the Tasks Filter menu is not drawn.
// src/lib/board-sections.test.ts covers the shared rules, and
// tests/board-filter-hides-sections.spec.ts proves them in a browser. These
// checks pin only the wiring, and tolerate formatting.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [board, kanban, stack, table, menu] = await Promise.all([
  read("./board-view.tsx"),
  read("./board-kanban.tsx"),
  read("./board-card-stack.tsx"),
  read("./board-table.tsx"),
  read("./board-filter-menu.tsx"),
]);
const flat = (s) => s.replace(/\s+/g, " ");

// Both status views receive the Filter exclusions.
assert.equal((flat(board).match(/hiddenStatuses=\{excludedStatus\}/g) ?? []).length, 2, "Kanban and the card stack both receive the excluded statuses");

// The filter, the lanes, and the table groups use one project key and label.
assert.match(flat(board), /excludedProject\.has\(boardProjectKey\(c\)\)/, "the project filter keys cards like the lanes do");
assert.doesNotMatch(board, /cwd\.split\("\/"\)/, "the filter no longer invents folder-name sections the lanes don't draw");
for (const [name, source] of [["kanban", kanban], ["table", table]]) {
  assert.match(source, /boardProjectKey\(c\)/, `${name} groups cards by the shared project key`);
  assert.match(source, /boardProjectLabel\(key, projects\)/, `${name} labels groups with the shared label`);
  assert.doesNotMatch(source, /const NO_PROJECT_KEY = /, `${name} has no private copy of the No project key`);
}

// Kanban and the stack draw, and keyboard-walk, only visible statuses.
assert.match(flat(kanban), /visibleStatusSections\(COLUMNS, hiddenStatuses\)/);
assert.doesNotMatch(kanban, /\{COLUMNS\.map\(\(col\) => \{/, "no swimlane renders the fixed column list");
assert.match(flat(kanban), /const nextCol = visibleColumns\[nextIdx\];/, "keyboard moves land on a visible column");
assert.match(flat(stack), /visibleStatusSections\(SECTIONS, hiddenStatuses\)/);
assert.match(flat(stack), /selectedFilter !== "all" && hiddenStatuses\?\.has\(selectedFilter\) \? "all" : selectedFilter/, "an excluded selected tab falls back to All");
assert.match(flat(stack), /<PopoverLabel>Move to<\/PopoverLabel> \{SECTIONS\.map/, "Move to keeps every status");

// The menu always lists statuses, and counts exclusions across both dimensions.
assert.match(flat(menu), /Filter by status/);
assert.doesNotMatch(menu, /\bdimension\s*[:=?]/, "the menu no longer hides one dimension's exclusions");
assert.match(flat(board), /hiddenCount=\{filterCount\}/);
assert.match(flat(board), /const filterCount = excludedStatus\.size \+ excludedProject\.size;/);
assert.match(flat(board), /\|\| excludedProject\.size > 0\}/, "a hidden project section stays reachable on any grouping");
assert.match(flat(board), /headline="No tasks match your filters"/);
assert.match(flat(board), /setModalDefaultStatus\(newTaskStatus\)/, "New task lands in a visible status");
