// @ts-nocheck
import assert from "node:assert/strict";
import { readComposerHistory, writeComposerHistory } from "./composer-history.ts";

// A tiny in-memory localStorage stand-in (the helpers are SSR-guarded on
// `window`, so provide a global window for the node test run).
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const KEY = "cave:test-history";

assert.deepEqual(readComposerHistory(KEY), [], "missing key reads as empty history");

writeComposerHistory(KEY, ["one", "two", "three"]);
assert.deepEqual(readComposerHistory(KEY), ["one", "two", "three"], "round-trips a history array");

// Empty history removes the key rather than storing "[]".
writeComposerHistory(KEY, []);
assert.equal(store.has(KEY), false, "empty history clears the stored key");

// Capped at 50 most-recent entries.
const big = Array.from({ length: 70 }, (_, i) => `p${i}`);
writeComposerHistory(KEY, big);
const stored = readComposerHistory(KEY);
assert.equal(stored.length, 50, "history is capped at 50 entries");
assert.equal(stored[0], "p20", "the oldest entries are dropped (keeps the most recent)");
assert.equal(stored[49], "p69", "the most recent entry is kept");

// Malformed JSON / non-array falls back to empty.
store.set(KEY, "{not json");
assert.deepEqual(readComposerHistory(KEY), [], "malformed storage falls back to empty");
store.set(KEY, JSON.stringify({ nope: 1 }));
assert.deepEqual(readComposerHistory(KEY), [], "non-array storage falls back to empty");

console.log("composer-history.test.ts: ok");
