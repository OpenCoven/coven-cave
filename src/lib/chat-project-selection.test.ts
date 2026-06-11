// @ts-nocheck
import assert from "node:assert/strict";
import {
  selectionKey,
  applyProjectScope,
  normalizeSelection,
  readPersisted,
  PROJECT_SIDEBAR_KEYS,
} from "./chat-project-selection.ts";

const group = (projectRoot, n = 1) => ({
  projectRoot,
  sessions: Array.from({ length: n }, (_, i) => ({ id: `${projectRoot ?? "none"}-${i}` })),
  defaultFamiliarId: null,
  updatedAt: "2026-06-11T00:00:00Z",
});

// selectionKey: null root maps to the "none" sentinel
assert.equal(selectionKey("/Users/x/repos/coven-cave"), "/Users/x/repos/coven-cave");
assert.equal(selectionKey(null), "none");

// applyProjectScope: "all" passes groups through untouched (same reference)
const groups = [group("/a"), group("/b", 2), group(null)];
assert.equal(applyProjectScope(groups, "all"), groups);

// specific root → single matching group
assert.deepEqual(applyProjectScope(groups, "/b").map((g) => g.projectRoot), ["/b"]);

// "none" → the null-root group
assert.deepEqual(applyProjectScope(groups, "none").map((g) => g.projectRoot), [null]);

// missing root → empty
assert.deepEqual(applyProjectScope(groups, "/gone"), []);

// normalizeSelection: keeps live selections, falls back to "all" for stale ones
assert.equal(normalizeSelection("all", groups), "all");
assert.equal(normalizeSelection("/a", groups), "/a");
assert.equal(normalizeSelection("none", groups), "none");
assert.equal(normalizeSelection("/gone", groups), "all");
assert.equal(normalizeSelection("none", [group("/a")]), "all");

// readPersisted: no window in node → fallback (SSR-safe)
assert.equal(readPersisted("cave:test:key", "fallback"), "fallback");
assert.deepEqual(readPersisted("cave:test:key", []), []);

// storage keys are stable contract values
assert.equal(PROJECT_SIDEBAR_KEYS.open, "cave:chat:project-sidebar-open");
assert.equal(PROJECT_SIDEBAR_KEYS.expanded, "cave:chat:project-sidebar-expanded");
assert.equal(PROJECT_SIDEBAR_KEYS.selected, "cave:chat:project-selected");

console.log("chat-project-selection tests passed");
