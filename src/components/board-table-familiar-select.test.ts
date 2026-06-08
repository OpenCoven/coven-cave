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
  /className="board-table-familiar-select"[\s\S]*value=\{card\.familiarId \?\? ""\}[\s\S]*onChange=\{\(e\) => onPatch\(card\.id, \{ familiarId: e\.target\.value \|\| null \}\)\}/,
  "Familiar column should render an inline select that patches card.familiarId",
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

console.log("board table familiar select guard passed");
