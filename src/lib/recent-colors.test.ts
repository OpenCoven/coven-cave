import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { addRecentColor, getRecentColors, RECENT_COLORS_KEY, MAX_RECENTS } from "./recent-colors.ts";

// Minimal in-memory localStorage shim for node.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("recent-colors", () => {
  it("starts empty", () => {
    assert.deepEqual(getRecentColors(), []);
  });

  it("normalizes to lowercase 6-char #rrggbb and stores", () => {
    addRecentColor("#AABBCC");
    assert.deepEqual(getRecentColors(), ["#aabbcc"]);
  });

  it("strips alpha to 6-char hex", () => {
    addRecentColor("#aabbccdd");
    assert.deepEqual(getRecentColors(), ["#aabbcc"]);
  });

  it("dedupes by moving an existing color to the front", () => {
    addRecentColor("#111111");
    addRecentColor("#222222");
    addRecentColor("#111111");
    assert.deepEqual(getRecentColors(), ["#111111", "#222222"]);
  });

  it(`caps the list at ${MAX_RECENTS}`, () => {
    for (let i = 0; i < MAX_RECENTS + 3; i++) {
      addRecentColor(`#0000${i.toString(16).padStart(2, "0")}`);
    }
    assert.equal(getRecentColors().length, MAX_RECENTS);
  });

  it("ignores invalid input", () => {
    addRecentColor("not-a-color");
    addRecentColor("");
    assert.deepEqual(getRecentColors(), []);
  });

  it("returns [] on garbage in storage", () => {
    localStorage.setItem(RECENT_COLORS_KEY, "{not json");
    assert.deepEqual(getRecentColors(), []);
  });

  it("returns the stored list (not the attempted add) when setItem throws", () => {
    addRecentColor("#abcdef");
    // Make the next write fail.
    (globalThis as any).localStorage.setItem = () => {
      throw new Error("QuotaExceeded");
    };
    const result = addRecentColor("#123456");
    assert.deepEqual(result, ["#abcdef"], "should reflect stored state, not the failed add");
  });
});
