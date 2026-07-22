// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const boardTable = await readFile(new URL("./board-table.tsx", import.meta.url), "utf8");
const boardView = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");

assert.match(
  boardTable,
  /onPatch: \(id: string, patch: Partial<Card>\) => void/,
  "BoardTable should accept task patching so inline familiar changes persist",
);
assert.match(
  boardTable,
  /useProjectFamiliarsByProject\(\{ projectIds \}\)/,
  "Table mode fetches authorized familiar rosters for every project it displays",
);
assert.match(
  boardTable,
  /const rowFamiliarOptions = !projectId[\s\S]*?familiarOptions[\s\S]*?Loading authorized familiars…[\s\S]*?scopedFamiliars\.map/,
  "project-backed table rows only offer their authorized roster while unscoped rows preserve every familiar",
);
assert.match(
  boardTable,
  /<StandardSelect[\s\S]*className="board-table-familiar-select"[\s\S]*value=\{familiarPickerReady \? card\.familiarId \?\? "" : ""\}[\s\S]*onChange=\{\(next\) => onPatch\(card\.id, \{ familiarId: next \|\| null, sessionId: null \}\)\}[\s\S]*options=\{rowFamiliarOptions\}[\s\S]*disabled=\{!familiarPickerReady\}/,
  "Familiar column gates project-backed choices until authorization has loaded and unlinks the prior runtime session",
);
assert.match(
  boardTable,
  /onClick=\{\(e\) => e\.stopPropagation\(\)\}/,
  "Inline familiar selector should not trigger row selection while changing",
);
assert.match(
  boardView,
  /<BoardTable[\s\S]*onPatch=\{patchCard\}/,
  "BoardView should wire BoardTable inline edits to the existing patchCard flow",
);

// ── Title cell shows a paperclip count when the card carries attachments ─────
assert.match(
  boardTable,
  /className="board-table-attach-count[^"]*"[\s\S]*?ph:paperclip[\s\S]*?card\.attachments!\.length/,
  "the table's title cell surfaces a paperclip + attachment count (kanban parity)",
);

console.log("board table familiar select guard passed");
