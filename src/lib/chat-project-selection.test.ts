// @ts-nocheck
import assert from "node:assert/strict";
import {
  selectionKey,
  projectSelectionKeys,
  applyProjectScope,
  autoExpandKeysForNewSessions,
  normalizeSelection,
  readPersisted,
  PROJECT_SIDEBAR_KEYS,
} from "./chat-project-selection.ts";
import {
  NO_PROJECT_ORGANIZATION,
  organizationExpansionKey,
} from "./project-organizations.ts";

const T0 = Date.parse("2026-06-11T12:00:00Z"); // baseline capture instant
const RECENT = "2026-06-11T12:30:00Z"; // created after the baseline
const OLD = "2026-06-01T00:00:00Z"; // created long before the baseline

const group = (
  projectId,
  projectRoot,
  n = 1,
  createdAt = RECENT,
  organization = { key: "opencoven", label: "opencoven", source: "github" },
) => ({
  projectId,
  projectRoot,
  organization,
  sessions: Array.from({ length: n }, (_, i) => ({
    id: `${projectId ?? "none"}-${i}`,
    created_at: createdAt,
  })),
  defaultFamiliarId: null,
  updatedAt: "2026-06-11T00:00:00Z",
});

// selectionKey: null project id maps to the "none" sentinel unless an unknown
// root needs its own fallback bucket.
assert.equal(selectionKey("coven-cave"), "coven-cave");
assert.equal(selectionKey(null), "none");
assert.equal(selectionKey(null, "/orphan/root"), "root:/orphan/root");

// applyProjectScope: "all" passes groups through untouched (same reference)
const groups = [group("alpha", "/alpha"), group(null, null, 1, RECENT, NO_PROJECT_ORGANIZATION)];
assert.deepEqual(projectSelectionKeys(groups), [
  organizationExpansionKey("opencoven"),
  "alpha",
  organizationExpansionKey(NO_PROJECT_ORGANIZATION.key),
  "none",
]);
assert.equal(applyProjectScope(groups, "all"), groups);

const projectScopeGroups = [group("a", "/a"), group("b", "/b", 2), group(null, "/orphan/root"), group(null, null)];

// specific project id → single matching group
assert.deepEqual(applyProjectScope(projectScopeGroups, "b").map((g) => g.projectRoot), ["/b"]);

// "none" → the null-root group
assert.deepEqual(applyProjectScope(projectScopeGroups, "none").map((g) => g.projectRoot), [null]);

// unknown roots get stable fallback keys and do not collide with "none"
assert.deepEqual(applyProjectScope(projectScopeGroups, "root:/orphan/root").map((g) => g.projectRoot), ["/orphan/root"]);

// missing project id → empty
assert.deepEqual(applyProjectScope(projectScopeGroups, "gone"), []);

// normalizeSelection: keeps live selections, falls back to "all" for stale ones
assert.equal(normalizeSelection("all", projectScopeGroups), "all");
assert.equal(normalizeSelection("a", projectScopeGroups), "a");
assert.equal(normalizeSelection("none", projectScopeGroups), "none");
assert.equal(normalizeSelection("root:/orphan/root", projectScopeGroups), "root:/orphan/root");
assert.equal(normalizeSelection("gone", projectScopeGroups), "all");
assert.equal(normalizeSelection("none", [group("a", "/a")]), "all");

// readPersisted: no window in node → fallback (SSR-safe)
assert.equal(readPersisted("cave:test:key", "fallback"), "fallback");
assert.deepEqual(readPersisted("cave:test:key", []), []);

// storage keys are stable contract values
assert.equal(PROJECT_SIDEBAR_KEYS.open, "cave:chat:project-sidebar-open");
assert.equal(PROJECT_SIDEBAR_KEYS.expanded, "cave:chat:project-sidebar-expanded");
assert.equal(PROJECT_SIDEBAR_KEYS.selected, "cave:chat:project-selected");

// ── autoExpandKeysForNewSessions (cave-mllp, recency guard cave-a9w9) ────────

// first chat in a fresh project folder: new key + first-seen recent session →
// expand
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group("alpha", "/alpha"), group("beta", "/beta")],
    knownSessionIds: new Set(["alpha-0"]),
    knownGroupKeys: new Set(["alpha"]),
    activeSessionId: null,
    newSinceMs: T0,
  }),
  ["org:opencoven", "beta"],
);

// root-fallback keys expand under their root-scoped key
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group(null, "/orphan/root", 1, RECENT, NO_PROJECT_ORGANIZATION)],
    knownSessionIds: new Set(),
    knownGroupKeys: new Set(),
    activeSessionId: null,
    newSinceMs: T0,
  }),
  [organizationExpansionKey(NO_PROJECT_ORGANIZATION.key), "root:/orphan/root"],
);

// filter reveal (familiar switch): new key but every session already known →
// the user's collapsed state wins
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group("beta", "/beta")],
    knownSessionIds: new Set(["beta-0"]),
    knownGroupKeys: new Set(),
    activeSessionId: null,
    newSinceMs: T0,
  }),
  [],
);

// recovery/backfill/scope reveal (cave-a9w9): unseen key, first-seen session,
// but the chat predates the baseline → it's old, not new — stay collapsed
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group("beta", "/beta", 1, OLD)],
    knownSessionIds: new Set(["alpha-0"]),
    knownGroupKeys: new Set(["alpha"]),
    activeSessionId: null,
    newSinceMs: T0,
  }),
  [],
);

// unparsable created_at fails closed for the new-folder path
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group("beta", "/beta", 1, "not-a-date")],
    knownSessionIds: new Set(["alpha-0"]),
    knownGroupKeys: new Set(["alpha"]),
    activeSessionId: null,
    newSinceMs: T0,
  }),
  [],
);

// the ACTIVE chat bypasses recency: end-of-stream persistence can land its
// row (with an older created_at) well after the chat began
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group("beta", "/beta", 1, OLD)],
    knownSessionIds: new Set(["alpha-0"]),
    knownGroupKeys: new Set(["alpha"]),
    activeSessionId: "beta-0",
    newSinceMs: T0,
  }),
  ["org:opencoven", "beta"],
);

// background session landing in an existing collapsed folder: don't force open
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group("alpha", "/alpha", 2)], // alpha-0 known, alpha-1 fresh
    knownSessionIds: new Set(["alpha-0"]),
    knownGroupKeys: new Set(["alpha"]),
    activeSessionId: null,
    newSinceMs: T0,
  }),
  [],
);

// …unless the fresh session is the active one (this surface just started it)
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group("alpha", "/alpha", 2)],
    knownSessionIds: new Set(["alpha-0"]),
    knownGroupKeys: new Set(["alpha"]),
    activeSessionId: "alpha-1",
    newSinceMs: T0,
  }),
  ["org:opencoven", "alpha"],
);

// an already-known active session never re-expands a collapsed folder
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups: [group("alpha", "/alpha")],
    knownSessionIds: new Set(["alpha-0"]),
    knownGroupKeys: new Set(["alpha"]),
    activeSessionId: "alpha-0",
    newSinceMs: T0,
  }),
  [],
);

console.log("chat-project-selection tests passed");
