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

// Toolbar control + gating + inline confirm. The trash icon button owns the
// destructive verbs: outside select mode it is Clear done, gated on the
// done-card count; the confirm group replaces it inline while deciding.
assert.match(source, /Clear done/, "Clear done control label present");
assert.match(
  source,
  /title=\{cardSelect\.selectMode \? "Delete selected" : "Clear done"\}/,
  "the trash button reads Clear done outside select mode, Delete selected inside",
);
assert.match(
  source,
  /disabled=\{cardSelect\.selectMode \? !hasSelection : doneCards\.length === 0\}/,
  "Clear done gated on done-card count; Delete selected on the selection",
);
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

// handleUndoClear: RESTORE the stored records, don't re-create them.
//
// These two assertions used to pin the opposite — "undo re-creates cards via
// POST /api/board" and "undo maps steps to {text}[] for POST". That was the
// defect written down as a contract: re-creating minted a new card id (breaking
// every Bead/GitHub reference to a completed mirror) and the {text}-only step
// mapping is precisely how step state was lost. cave-xddxs replaced it.
const undoFn = source.match(/const handleUndoClear = async[\s\S]*?\n {2}\};/)?.[0] ?? "";
assert.match(
  undoFn,
  /"\/api\/board\/restore", \{[\s\S]*?method: "POST"/,
  "undo restores through /api/board/restore",
);
assert.match(
  undoFn,
  /body: JSON\.stringify\(\{ cards: banner\.snapshot \}\)/,
  "undo sends the whole stored snapshot, not a rebuilt subset of fields",
);
assert.doesNotMatch(
  undoFn,
  /\.map\(\(s\) => \(\{ text: s\.text \}\)\)/,
  "undo no longer flattens steps to text, which dropped done/doneAt/dates",
);

// Undo banner with an Undo action.
assert.match(source, /clearedBanner &&/, "undo banner renders when a clear just happened");
assert.match(source, /onClick=\{\(\) => void handleUndoClear\(\)\}/, "undo banner has an Undo button");

console.log("board-clear-done source assertions passed");
