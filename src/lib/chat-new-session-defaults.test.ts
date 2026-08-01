// @ts-nocheck
// New-session defaults (Chat.dc.html 2b — "Save as default").
//
// The button is only worth having if the value it writes actually wins at
// session start, and only safe if a stale value cannot pin a new chat to a
// project that no longer exists. Both are pinned here.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearNewSessionDefaults,
  newSessionDefaults,
  newSessionDefaultsMatch,
  readNewSessionDefaults,
  writeNewSessionDefaults,
} from "./chat-new-session-defaults.ts";
import { resolveChatProjectSelection } from "./chat-projects.ts";

function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}
const KEY = "cave:chat:new-session-defaults:v1";

test("round-trips a saved selection", () => {
  const s = storage();
  writeNewSessionDefaults(s, { projectId: "p1", model: "sonnet-5" });
  assert.deepEqual(readNewSessionDefaults(s), { projectId: "p1", model: "sonnet-5" });
});

test("no storage, absent key and corrupt JSON all mean 'no opinion'", () => {
  assert.deepEqual(readNewSessionDefaults(null), newSessionDefaults());
  assert.deepEqual(readNewSessionDefaults(storage()), newSessionDefaults());
  assert.deepEqual(readNewSessionDefaults(storage({ [KEY]: "{not json" })), newSessionDefaults());
  // A corrupt value must never throw on boot — that would take the composer out.
  assert.doesNotThrow(() => readNewSessionDefaults(storage({ [KEY]: "[]" })));
});

test("a default naming something that no longer exists is dropped, not honoured", () => {
  const s = storage();
  writeNewSessionDefaults(s, { projectId: "deleted", model: "retired" });
  const read = readNewSessionDefaults(s, { projectIds: ["p1"], models: ["sonnet-5"] });
  assert.equal(read.projectId, null, "a deleted project falls back to inference");
  assert.equal(read.model, null, "a retired model falls back to the familiar's own");
  // Unvalidated reads (no known lists) still return the raw value.
  assert.equal(readNewSessionDefaults(s).projectId, "deleted");
});

test("writes survive a storage that throws (private mode / quota)", () => {
  const hostile = { setItem: () => { throw new Error("quota"); } };
  assert.doesNotThrow(() => writeNewSessionDefaults(hostile, { projectId: "p1", model: null }));
});

test("match reports when saving would be a no-op", () => {
  const saved = { projectId: "p1", model: "sonnet-5" };
  assert.equal(newSessionDefaultsMatch(saved, { projectId: "p1", model: "sonnet-5" }), true);
  assert.equal(newSessionDefaultsMatch(saved, { projectId: "p2", model: "sonnet-5" }), false);
  // undefined and null are the same "unset" to the caller.
  assert.equal(newSessionDefaultsMatch({ projectId: null, model: null }, {}), true);
});

test("clear removes the key entirely rather than writing nulls", () => {
  const s = storage();
  writeNewSessionDefaults(s, { projectId: "p1", model: null });
  clearNewSessionDefaults(s);
  assert.equal(s._map.has(KEY), false);
});

// ── The half that makes the button real ────────────────────────────────────
const PROJECTS = [
  { id: "p1", name: "One", root: "/repo/one" },
  { id: "p2", name: "Two", root: "/repo/two" },
];

test("a pinned default beats the recent-chat inference", () => {
  const picked = resolveChatProjectSelection({
    draftId: null,
    hasSession: false,
    sessionProjectRoot: null,
    fallbackProjectRoot: null,
    recentProjectRoot: "/repo/two",
    defaultProjectId: "p1",
    projects: PROJECTS,
  });
  assert.equal(picked.projectId, "p1", "an explicit choice outranks a guess");
});

test("but every contextual signal still outranks the pinned default", () => {
  const draft = resolveChatProjectSelection({
    draftId: "p2", hasSession: false, sessionProjectRoot: null, fallbackProjectRoot: null,
    defaultProjectId: "p1", projects: PROJECTS,
  });
  assert.equal(draft.projectId, "p2", "an in-session pick wins");

  const task = resolveChatProjectSelection({
    draftId: null, hasSession: false, sessionProjectRoot: null, fallbackProjectRoot: null,
    taskProjectId: "p2", defaultProjectId: "p1", projects: PROJECTS,
  });
  assert.equal(task.projectId, "p2", "a linked task's project wins — opening a card must land on it");
});

test("a pinned default naming a deleted project falls through, it does not blank the selection", () => {
  const picked = resolveChatProjectSelection({
    draftId: null, hasSession: false, sessionProjectRoot: null, fallbackProjectRoot: null,
    recentProjectRoot: "/repo/two", defaultProjectId: "gone", projects: PROJECTS,
  });
  assert.equal(picked.projectId, "p2", "falls back to the recent-chat inference");
});
