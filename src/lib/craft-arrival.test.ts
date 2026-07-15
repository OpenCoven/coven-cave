import assert from "node:assert/strict";
import {
  CRAFT_ARRIVAL_KEY,
  CRAFT_ARRIVAL_MAX_AGE_MS,
  clearCraftArrivalWatch,
  findArrivedDraftId,
  readCraftArrivalWatch,
  writeCraftArrivalWatch,
  type CraftArrivalWatch,
} from "./craft-arrival.ts";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const now = Date.parse("2026-07-15T12:00:00.000Z");

// Round trip: write → read returns the same watch.
{
  const storage = memoryStorage();
  const watch: CraftArrivalWatch = {
    baselineIds: ["a", "b"],
    dispatchedAt: new Date(now - 1000).toISOString(),
    goal: "review loadout",
    familiar: "cody",
  };
  writeCraftArrivalWatch(watch, storage);
  assert.deepEqual(readCraftArrivalWatch(storage, now), watch);
}

// Staleness: a watch older than the max age is dropped AND removed.
{
  const storage = memoryStorage();
  writeCraftArrivalWatch({
    baselineIds: [],
    dispatchedAt: new Date(now - CRAFT_ARRIVAL_MAX_AGE_MS - 1).toISOString(),
    goal: "old",
  }, storage);
  assert.equal(readCraftArrivalWatch(storage, now), null);
  assert.equal(storage.map.has(CRAFT_ARRIVAL_KEY), false, "stale watch is removed");
}

// Future-dated and unparsable timestamps are dropped.
{
  const storage = memoryStorage();
  writeCraftArrivalWatch({
    baselineIds: [],
    dispatchedAt: new Date(now + 60_000).toISOString(),
    goal: "future",
  }, storage);
  assert.equal(readCraftArrivalWatch(storage, now), null);
}

// Malformed JSON and wrong shapes clear themselves.
{
  const storage = memoryStorage();
  storage.setItem(CRAFT_ARRIVAL_KEY, "{nope");
  assert.equal(readCraftArrivalWatch(storage, now), null);
  assert.equal(storage.map.has(CRAFT_ARRIVAL_KEY), false);
  storage.setItem(CRAFT_ARRIVAL_KEY, JSON.stringify({ baselineIds: [1], dispatchedAt: "x", goal: 2 }));
  assert.equal(readCraftArrivalWatch(storage, now), null);
  assert.equal(storage.map.has(CRAFT_ARRIVAL_KEY), false);
}

// Optional familiar only survives as a non-empty string.
{
  const storage = memoryStorage();
  writeCraftArrivalWatch({
    baselineIds: [],
    dispatchedAt: new Date(now).toISOString(),
    goal: "g",
    familiar: "",
  }, storage);
  const read = readCraftArrivalWatch(storage, now);
  assert.equal(read?.familiar, undefined);
}

// Clear removes the record.
{
  const storage = memoryStorage();
  writeCraftArrivalWatch({ baselineIds: [], dispatchedAt: new Date(now).toISOString(), goal: "g" }, storage);
  clearCraftArrivalWatch(storage);
  assert.equal(readCraftArrivalWatch(storage, now), null);
}

// Arrival = the first id NOT in the baseline; baseline and missing ids never match.
{
  const watch: CraftArrivalWatch = {
    baselineIds: ["a", "b"],
    dispatchedAt: new Date(now).toISOString(),
    goal: "g",
  };
  assert.equal(findArrivedDraftId(watch, ["a", "b"]), null);
  assert.equal(findArrivedDraftId(watch, ["a", undefined, "c", "d"]), "c");
  assert.equal(findArrivedDraftId(watch, []), null);
}

// Null storage (SSR / refused sessionStorage) degrades quietly.
{
  assert.equal(readCraftArrivalWatch(null, now), null);
  writeCraftArrivalWatch({ baselineIds: [], dispatchedAt: new Date(now).toISOString(), goal: "g" }, null);
  clearCraftArrivalWatch(null);
}

console.log("craft-arrival.test.ts: ok");
