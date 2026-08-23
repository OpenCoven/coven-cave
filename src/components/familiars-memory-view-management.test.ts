import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = [
  await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./familiars-memory-files.tsx", import.meta.url), "utf8"),
].join("\n");

assert.match(source, /useUndoDelete/, "uses the shared undo-delete hook");
assert.match(source, /<UndoToast/, "renders the shared undo toast");
assert.doesNotMatch(source, /LibraryUndoToast|styles\/library\.css/, "memory view should not depend on feature-branch Library code");
assert.match(source, /\[groupMode, setGroupMode\]/, "tracks group mode");
assert.match(source, /\[staleOnly, setStaleOnly\]/, "tracks stale-only filter");
assert.match(source, /"oldest"|"staleFirst"/, "sort mode extended");
assert.match(source, /detectStale|ruleBasedStaleScorer/, "uses the stale scorer");
assert.match(source, /ariaLabel="Memory filters"/, "management controls live in the filter popover");
assert.match(source, />\s*Stale only\s*</, "the stale-only control remains explicit");
assert.match(source, /<span>\{suggestions\.length\}<\/span>/, "the stale-only control keeps its truthful count");
assert.match(source, /classifyProtection|protection === "bulk-protected"|protection === "structural"/, "respects protection tiers");
console.log("familiars-memory-view-management.test: ok");
