// @ts-nocheck
import assert from "node:assert/strict";
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
};
const { getFeedback, setFeedback } = await import("./message-feedback.ts");
assert.equal(getFeedback("m1"), null, "no feedback by default");
setFeedback("m1", "up");
assert.equal(getFeedback("m1"), "up", "thumbs-up persisted");
setFeedback("m1", "up");
assert.equal(getFeedback("m1"), null, "re-applying same vote clears it (toggle)");
setFeedback("m1", "down");
assert.equal(getFeedback("m1"), "down", "switching vote overwrites");
console.log("message-feedback ok");
