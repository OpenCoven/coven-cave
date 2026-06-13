import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

assert.match(source, /useUndoDelete/, "uses the shared undo-delete hook");
assert.match(source, /LibraryUndoToast/, "renders the undo toast");
assert.match(source, /\[groupMode, setGroupMode\]/, "tracks group mode");
assert.match(source, /\[staleOnly, setStaleOnly\]/, "tracks stale-only filter");
assert.match(source, /"oldest"|"staleFirst"/, "sort mode extended");
assert.match(source, /detectStale|ruleBasedStaleScorer/, "uses the stale scorer");
assert.match(source, /Suggested for cleanup/, "renders a suggestions section");
assert.match(source, /classifyProtection|protection === "bulk-protected"|protection === "structural"/, "respects protection tiers");
console.log("agents-memory-view-management.test: ok");
