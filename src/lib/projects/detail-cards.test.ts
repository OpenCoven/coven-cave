import assert from "node:assert/strict";

import {
  DETAIL_CARD_DEFAULT_OPEN,
  capVisible,
  detailCardKey,
  readDetailCardOpen,
  showMoreLabel,
  writeDetailCardOpen,
} from "./detail-cards.ts";

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

// Defaults mirror the mock: Tasks open, Sessions and Access closed.
assert.equal(DETAIL_CARD_DEFAULT_OPEN.tasks, true);
assert.equal(DETAIL_CARD_DEFAULT_OPEN.sessions, false);
assert.equal(DETAIL_CARD_DEFAULT_OPEN.access, false);

// Keys are namespaced per card.
assert.equal(detailCardKey("tasks"), "cave:projects:card:tasks");

// Read falls back to the default when storage is empty, missing, or throwing.
assert.equal(readDetailCardOpen(fakeStorage(), "tasks"), true);
assert.equal(readDetailCardOpen(fakeStorage(), "access"), false);
assert.equal(readDetailCardOpen(null, "sessions"), false);
assert.equal(
  readDetailCardOpen(
    { getItem: () => { throw new Error("quota"); }, setItem: () => {} },
    "tasks",
  ),
  true,
);

// Persisted values win over defaults, in both directions.
const store = fakeStorage({ "cave:projects:card:tasks": "0", "cave:projects:card:access": "1" });
assert.equal(readDetailCardOpen(store, "tasks"), false);
assert.equal(readDetailCardOpen(store, "access"), true);

// Garbage in storage falls back to the default.
assert.equal(readDetailCardOpen(fakeStorage({ "cave:projects:card:tasks": "yes" }), "tasks"), true);

// Write round-trips, and a throwing store never throws out.
writeDetailCardOpen(store, "sessions", true);
assert.equal(readDetailCardOpen(store, "sessions"), true);
writeDetailCardOpen(
  { getItem: () => null, setItem: () => { throw new Error("quota"); } },
  "sessions",
  true,
);

// Cap math: collapsed slices, expanded shows all.
assert.deepEqual(capVisible([1, 2, 3, 4], 2, false), [1, 2]);
assert.deepEqual(capVisible([1, 2, 3, 4], 2, true), [1, 2, 3, 4]);

// Show-more label: null when everything fits, counts when capped.
assert.equal(showMoreLabel(3, 5, false, "tasks"), null);
assert.equal(showMoreLabel(9, 5, false, "tasks"), "Show all 9 tasks");
assert.equal(showMoreLabel(9, 5, true, "tasks"), "Show fewer");

console.log("detail-cards.test.ts: ok");
