// @ts-nocheck
import assert from "node:assert/strict";

// Fresh in-memory localStorage stub (module reads window.localStorage).
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

const { getPinnedSessionIds, isSessionPinned, toggleSessionPin, subscribeSessionPins } =
  await import("./session-pins.ts");

assert.deepEqual(getPinnedSessionIds(), [], "no pins by default");
assert.equal(isSessionPinned("s1"), false, "unknown id not pinned");

let fired = 0;
const unsub = subscribeSessionPins(() => { fired += 1; });
toggleSessionPin("s1");
assert.deepEqual(getPinnedSessionIds(), ["s1"], "pin adds id");
assert.equal(isSessionPinned("s1"), true, "pinned after toggle");
assert.ok(fired >= 1, "subscribers notified on change");

toggleSessionPin("s2");
assert.deepEqual(getPinnedSessionIds(), ["s1", "s2"], "second pin appended in order");

toggleSessionPin("s1");
assert.deepEqual(getPinnedSessionIds(), ["s2"], "toggle removes existing id");
unsub();

// ── Snapshot stability (useSyncExternalStore contract) ───────────────────────
// getPinnedSessionIds is the getSnapshot for useSessionPins. It MUST return a
// referentially-identical array between calls when nothing changed — otherwise
// React loops forever ("Maximum update depth exceeded") and crashes the Code
// surface. It may only return a new reference after the value actually changes.
assert.equal(getPinnedSessionIds(), getPinnedSessionIds(), "repeated reads return the SAME array reference");
const before = getPinnedSessionIds();
toggleSessionPin("s3");
assert.notEqual(getPinnedSessionIds(), before, "a new reference appears after a real change");
assert.equal(getPinnedSessionIds(), getPinnedSessionIds(), "stable again once settled");

// The empty case must be stable too (the all-no-pins default path).
toggleSessionPin("s2");
toggleSessionPin("s3");
assert.deepEqual(getPinnedSessionIds(), [], "back to empty");
assert.equal(getPinnedSessionIds(), getPinnedSessionIds(), "empty snapshot is a stable reference");

console.log("session-pins ok");
