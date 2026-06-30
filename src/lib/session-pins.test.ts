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

// Snapshot stability: useSyncExternalStore requires getSnapshot to return the
// SAME reference until a mutation, else React throws "getSnapshot should be
// cached to avoid an infinite loop". Two reads with no mutation between must be
// identical (===), and a mutation must produce a fresh reference.
const snapA = getPinnedSessionIds();
assert.equal(getPinnedSessionIds(), snapA, "repeated reads return the same reference (cached snapshot)");
toggleSessionPin("s3");
assert.notEqual(getPinnedSessionIds(), snapA, "a mutation yields a new reference");
unsub();

console.log("session-pins ok");
