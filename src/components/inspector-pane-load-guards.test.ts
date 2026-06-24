// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");

// The inspector's three memory loaders (coven-memory, the per-familiar file
// list, and the open-file contents) all set state from an async fetch. Each
// must guard against stale / post-unmount responses with a cancelled flag, or:
//   - a response could call setState after the pane unmounts, and
//   - switching familiars / files could let an older request's response
//     overwrite the newer selection (a cross-familiar list leak for /api/memory).

// Every effect that awaits a fetch declares a cancelled flag and a cleanup.
const cancelledDecls = src.match(/let cancelled = false;/g) ?? [];
assert.ok(cancelledDecls.length >= 3, "all three memory loaders declare a cancelled guard");
const cleanups = src.match(/return \(\) => \{ cancelled = true; \};/g) ?? [];
assert.ok(cleanups.length >= 3, "each guarded loader cleans up by cancelling in-flight work");

// coven-memory: guards the setState and the loaded flag.
assert.match(
  src,
  /fetch\("\/api\/coven-memory"[\s\S]*?if \(cancelled\) return;[\s\S]*?setCovenEntries/,
  "the coven-memory loader drops stale/post-unmount responses",
);
assert.match(src, /if \(!cancelled\) setCovenLoaded\(true\);/, "the coven-memory loaded flag is only set while mounted");

// per-familiar file list: guards before applying entries so a previous
// familiar's response can't overwrite the current one.
assert.match(
  src,
  /\/api\/memory\?familiarId[\s\S]*?if \(cancelled\) return;[\s\S]*?setEntries/,
  "the per-familiar memory list drops a superseded response (no cross-familiar leak)",
);

// open-file contents: guards before setOpenFile.
assert.match(
  src,
  /\/api\/memory\/file\?path[\s\S]*?if \(cancelled\) return;[\s\S]*?setOpenFile\(json\)/,
  "the open-file loader drops a stale response when the selection changes",
);

console.log("inspector-pane-load-guards.test.ts: ok");
