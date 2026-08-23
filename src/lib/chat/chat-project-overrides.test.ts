// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";

// Minimal localStorage + window shim so the module's browser guards run.
const store = new Map();
let dispatched = 0;
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  dispatchEvent: () => {
    dispatched += 1;
    return true;
  },
};
globalThis.CustomEvent = class {
  constructor(type) {
    this.type = type;
  }
};

const {
  readProjectOverrides,
  setProjectOverride,
  clearProjectOverride,
  applyProjectOverrides,
  pruneProjectOverrides,
} = await import("./chat-project-overrides.ts");

const reset = () => {
  store.clear();
  dispatched = 0;
};

test("set/read round-trips and notifies", () => {
  reset();
  setProjectOverride("s1", "/repo/b");
  assert.deepEqual(readProjectOverrides(), { s1: "/repo/b" });
  assert.equal(dispatched, 1, "writing dispatches a change event");
});

test("setting the same value is a no-op (no event)", () => {
  reset();
  setProjectOverride("s1", "/repo/b");
  dispatched = 0;
  setProjectOverride("s1", "/repo/b");
  assert.equal(dispatched, 0, "unchanged value does not re-write/notify");
});

test("clear removes the override", () => {
  reset();
  setProjectOverride("s1", "/repo/b");
  clearProjectOverride("s1");
  assert.deepEqual(readProjectOverrides(), {});
});

test('empty-string override = ungrouped bucket', () => {
  reset();
  setProjectOverride("s1", "");
  assert.deepEqual(readProjectOverrides(), { s1: "" });
});

test("applyProjectOverrides replaces project_root, keeps reference when unchanged", () => {
  const sessions = [
    { id: "s1", project_root: "/repo/a" },
    { id: "s2", project_root: "/repo/a" },
  ];
  assert.equal(applyProjectOverrides(sessions, {}), sessions, "no overrides → same reference");
  const moved = applyProjectOverrides(sessions, { s1: "/repo/b" });
  assert.notEqual(moved, sessions);
  assert.equal(moved[0].project_root, "/repo/b");
  assert.equal(moved[1].project_root, "/repo/a");
  assert.equal(sessions[0].project_root, "/repo/a", "input not mutated");
});

test("prune drops overrides for dead sessions and persists", () => {
  reset();
  setProjectOverride("s1", "/repo/b");
  setProjectOverride("s2", "/repo/c");
  const pruned = pruneProjectOverrides(readProjectOverrides(), ["s1"]);
  assert.deepEqual(pruned, { s1: "/repo/b" });
  assert.deepEqual(readProjectOverrides(), { s1: "/repo/b" }, "prune persisted");
});

console.log("chat-project-overrides.test.ts: ok");
