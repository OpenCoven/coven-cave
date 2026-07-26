import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearRecentSearches,
  readRecentSearches,
  recordRecentSearch,
} from "./recent-searches.ts";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("recent searches trim, dedupe case-insensitively, and cap at five", () => {
  const storage = new MemoryStorage();
  for (const query of ["one", "two", "three", "four", "five", "six", " TWO "]) {
    recordRecentSearch(storage, query);
  }
  assert.deepEqual(readRecentSearches(storage), ["TWO", "six", "five", "four", "three"]);
});

test("recent searches recover from malformed storage and clear explicitly", () => {
  const storage = new MemoryStorage();
  storage.setItem("cave:search:recent:v1", "not-json");
  assert.deepEqual(readRecentSearches(storage), []);
  recordRecentSearch(storage, "tasks");
  clearRecentSearches(storage);
  assert.deepEqual(readRecentSearches(storage), []);
});

