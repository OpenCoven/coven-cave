// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");

// doneCards is derived from the CURRENT-SCOPE filtered list (not all cards).
assert.match(
  source,
  /const doneCards = useMemo\(\s*\(\) => filtered\.filter\(\(c\) => c\.status === "done"\)/,
  "doneCards memo filters the current-scope `filtered` list by status done",
);

// Toolbar control + gating + inline confirm. Clear-done is an occasional
// destructive verb, so it lives in the shared overflow menu (§8 chrome
// budget); the confirm group replaces the menu inline while deciding.
assert.match(source, /Clear done/, "Clear done control label present");
assert.match(
  source,
  /<PopoverItem\s*icon="ph:trash"\s*danger\s*disabled=\{doneCards\.length === 0\}\s*onSelect=\{\(\) => setClearConfirm\(true\)\}/,
  "Clear done is a danger overflow-menu item, gated on done-card count",
);
assert.match(source, /disabled=\{doneCards\.length === 0\}/, "Clear done gated on done-card count");
assert.match(source, /setClearConfirm\(true\)/, "clicking the control opens an inline confirm");
assert.match(source, /Clear \{doneCards\.length\} done/, "confirm names the count");

// handleClearDone: optimistic remove + per-card DELETE + failure resync.
const clearFn = source.match(/const handleClearDone = async[\s\S]*?\n {2}\};/)?.[0] ?? "";
assert.match(clearFn, /setCards\(\(prev\) => prev\.filter\(/, "optimistically removes the done cards");
assert.match(clearFn, /`\/api\/board\/\$\{[^}]+\}`, \{ method: "DELETE" \}/, "fires DELETE per done card");
assert.match(clearFn, /await load\(\{ force: true \}\)/, "failure path bypasses the cache to resync from the server");
assert.match(clearFn, /setActionError\(/, "failure path surfaces the action banner");
assert.match(clearFn, /setClearedBanner\(/, "success path shows the undo banner");

assert.match(
  source,
  /onClick=\{\(\) => void load\(\{ force: true \}\)\}>\s*Retry/,
  "Board retry actions bypass a fresh warm-cache entry",
);

// handleUndoClear: re-create via POST.
const undoFn = source.match(/const handleUndoClear = async[\s\S]*?\n {2}\};/)?.[0] ?? "";
assert.match(undoFn, /"\/api\/board", \{[\s\S]*?method: "POST"/, "undo re-creates cards via POST /api/board");
assert.match(undoFn, /steps: [\s\S]*?\.map\(\(s\) => \(\{ text: s\.text \}\)\)/, "undo maps steps to {text}[] for POST");

// Undo banner with an Undo action.
assert.match(source, /clearedBanner &&/, "undo banner renders when a clear just happened");
assert.match(source, /onClick=\{\(\) => void handleUndoClear\(\)\}/, "undo banner has an Undo button");

console.log("board-clear-done source assertions passed");
