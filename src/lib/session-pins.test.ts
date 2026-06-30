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

console.log("session-pins ok");
