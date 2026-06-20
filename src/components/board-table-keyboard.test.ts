// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./board-table.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /import\s+\{[^}]*useRovingTabIndex[^}]*\}\s+from\s+["']@\/lib\/use-roving-tabindex["']/,
  "imports useRovingTabIndex",
);
assert.match(source, /useRovingTabIndex\(/, "calls useRovingTabIndex");
assert.match(
  source,
  /orientation:\s*["']vertical["']/,
  "uses vertical orientation",
);

// Rows handle Enter and Escape.
assert.match(source, /key === "Enter"/, "handles Enter to open");
assert.match(source, /key === "Escape"/, "handles Escape to deselect");

// Card rows are marked with the data attribute.
assert.match(
  source,
  /data-board-row="true"/,
  "card rows are marked data-board-row=true",
);
assert.match(
  source,
  /data-card-id=/,
  "card rows expose data-card-id",
);

// Sortable headers: keyboard-operable <button> + aria-sort state announced.
assert.match(source, /aria-sort=\{sortKey === col\.key/, "th announces aria-sort");
assert.match(source, /board-table-sort-btn/, "header label is a real button");
// Group rows: keyboard collapse/expand.
assert.match(source, /board-table-group-row" role="button" tabIndex=\{0\}/, "group row is a button");
assert.match(source, /aria-expanded=\{!collapsed\.has\(key\)\}/, "group row announces expanded state");

console.log("board-table-keyboard.test.ts OK");
