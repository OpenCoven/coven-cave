// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");
const kanban = readFileSync(new URL("./board-kanban.tsx", import.meta.url), "utf8");
const table = readFileSync(new URL("./board-table.tsx", import.meta.url), "utf8");

// board-view drives selection with the shared hook + toolbar.
assert.match(view, /useMultiSelect\(filtered, \(c\) => c\.id\)/, "board uses the shared useMultiSelect over the filtered cards");
assert.match(view, /import \{ SelectionToolbar \}/, "board imports the shared SelectionToolbar");
assert.match(view, /<SelectionToolbar/, "select mode renders the shared SelectionToolbar");
// The three bulk actions exist.
assert.match(view, /const bulkMove = async \(status: CardStatus\)/, "bulk move-to-status is wired");
assert.match(view, /const bulkAssign = async \(familiarId: string\)/, "bulk assign-familiar is wired");
assert.match(view, /const bulkDelete = \(\) =>/, "bulk delete is wired");
// Bulk delete is deferred + undoable (no native confirm): it routes through the
// shared useUndoDelete helper and raises an UndoToast instead of window.confirm.
assert.match(view, /deleteCards\(sel\)/, "bulk delete routes through the deferred deleteCards helper");
assert.doesNotMatch(view, /window\.confirm/, "board no longer uses a native confirm for deletes");
assert.match(view, /useUndoDelete<Card\[\]>\(\)/, "board uses the shared useUndoDelete hook");
assert.match(view, /<UndoToast/, "board renders the shared UndoToast for deletes");
// Select mode is threaded into BOTH the kanban and the table.
assert.match(view, /<BoardKanban[\s\S]*?selectMode=\{cardSelect\.selectMode\}/, "kanban receives select mode");
assert.match(view, /<BoardTable[\s\S]*?selectMode=\{cardSelect\.selectMode\}/, "table receives select mode");
// The Select entry button only shows for kanban/table, desktop, with cards.
assert.match(view, /viewMode === "kanban" \|\| viewMode === "table"[\s\S]*?cardSelect\.setSelectMode\(true\)/, "a Select button enters select mode for kanban/table");

// Kanban cards become checkboxes and stop being draggable in select mode.
assert.match(kanban, /<li draggable=\{!selectMode\}/, "kanban cards aren't draggable while selecting");
assert.match(kanban, /role=\{selectMode \? "checkbox" : "button"\}/, "kanban cards flip to checkbox role in select mode");
assert.match(kanban, /aria-checked=\{selectMode \? isSelected : undefined\}/, "kanban checkboxes expose aria-checked");

// Table rows toggle selection instead of opening in select mode.
assert.match(table, /onClick=\{\(\) => \(selectMode \? onToggleSelect\?\.\(card\.id\) : onSelect\(card\.id\)\)\}/, "table rows toggle selection in select mode");
assert.match(table, /aria-checked=\{selectMode \? rowChecked : undefined\}/, "table checkbox rows expose aria-checked");

console.log("board-bulk-select.test.ts: ok");
