// @ts-nocheck
import assert from "node:assert/strict";
import {
  selectionKey,
  projectSelectionKeys,
  applyProjectScope,
  normalizeSelection,
  readPersisted,
  PROJECT_SIDEBAR_KEYS,
} from "./chat-project-selection.ts";

const group = (projectId, projectRoot, n = 1) => ({
  projectId,
  projectRoot,
  sessions: Array.from({ length: n }, (_, i) => ({ id: `${projectId ?? "none"}-${i}` })),
  defaultFamiliarId: null,
  updatedAt: "2026-06-11T00:00:00Z",
});

// selectionKey: null project id maps to the "none" sentinel unless an unknown
// root needs its own fallback bucket.
assert.equal(selectionKey("coven-cave"), "coven-cave");
assert.equal(selectionKey(null), "none");
assert.equal(selectionKey(null, "/orphan/root"), "root:/orphan/root");

// applyProjectScope: "all" passes groups through untouched (same reference)
const groups = [group("a", "/a"), group("b", "/b", 2), group(null, "/orphan/root"), group(null, null)];
assert.deepEqual(projectSelectionKeys(groups), ["a", "b", "root:/orphan/root", "none"]);
assert.equal(applyProjectScope(groups, "all"), groups);

// specific project id → single matching group
assert.deepEqual(applyProjectScope(groups, "b").map((g) => g.projectRoot), ["/b"]);

// "none" → the null-root group
assert.deepEqual(applyProjectScope(groups, "none").map((g) => g.projectRoot), [null]);

// unknown roots get stable fallback keys and do not collide with "none"
assert.deepEqual(applyProjectScope(groups, "root:/orphan/root").map((g) => g.projectRoot), ["/orphan/root"]);

// missing project id → empty
assert.deepEqual(applyProjectScope(groups, "gone"), []);

// normalizeSelection: keeps live selections, falls back to "all" for stale ones
assert.equal(normalizeSelection("all", groups), "all");
assert.equal(normalizeSelection("a", groups), "a");
assert.equal(normalizeSelection("none", groups), "none");
assert.equal(normalizeSelection("root:/orphan/root", groups), "root:/orphan/root");
assert.equal(normalizeSelection("gone", groups), "all");
assert.equal(normalizeSelection("none", [group("a", "/a")]), "all");

// readPersisted: no window in node → fallback (SSR-safe)
assert.equal(readPersisted("cave:test:key", "fallback"), "fallback");
assert.deepEqual(readPersisted("cave:test:key", []), []);

// storage keys are stable contract values
assert.equal(PROJECT_SIDEBAR_KEYS.open, "cave:chat:project-sidebar-open");
assert.equal(PROJECT_SIDEBAR_KEYS.expanded, "cave:chat:project-sidebar-expanded");
assert.equal(PROJECT_SIDEBAR_KEYS.selected, "cave:chat:project-selected");

console.log("chat-project-selection tests passed");
