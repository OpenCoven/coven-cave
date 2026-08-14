// @ts-nocheck
import assert from "node:assert/strict";
import {
  CONSTELLATION_COLOR_COUNT,
  CONSTELLATION_VIEW,
  constellationPoints,
  constellationSeed,
  readStoredVisualBumps,
  writeStoredVisualBump,
} from "./journal-constellation.ts";

// ── Seeds ────────────────────────────────────────────────────────────────────
assert.equal(
  constellationSeed("2026-06-20", 0),
  constellationSeed("2026-06-20", 0),
  "same date + bump → same seed",
);
assert.notEqual(
  constellationSeed("2026-06-20", 0),
  constellationSeed("2026-06-21", 0),
  "different dates → different seeds",
);
assert.equal(
  constellationSeed("2026-06-20", 3) - constellationSeed("2026-06-20", 0),
  3 * 977,
  "regeneration bumps offset the seed deterministically",
);

// ── Geometry ─────────────────────────────────────────────────────────────────
{
  const seed = constellationSeed("2026-06-20", 0);
  const a = constellationPoints(seed);
  const b = constellationPoints(seed);
  assert.deepEqual(a, b, "the same seed always yields the same sketch (no server state needed)");
  assert.ok(a.length >= 8 && a.length <= 13, `8–13 stars (got ${a.length})`);
  for (const p of a) {
    assert.ok(p.x >= 0 && p.x <= CONSTELLATION_VIEW.width, "star x stays inside the viewBox");
    assert.ok(p.y >= 0 && p.y <= CONSTELLATION_VIEW.height, "star y stays inside the viewBox");
    assert.ok(p.r > 0, "star radius is positive");
    assert.ok(
      Number.isInteger(p.c) && p.c >= 0 && p.c < CONSTELLATION_COLOR_COUNT,
      "color index addresses the token palette",
    );
  }
  const c = constellationPoints(constellationSeed("2026-06-20", 1));
  assert.notDeepEqual(a, c, "a bumped seed rearranges the constellation");
}

// ── Per-date bump persistence ────────────────────────────────────────────────
assert.deepEqual(readStoredVisualBumps(), {}, "no window → empty map (SSR safe)");
assert.deepEqual(writeStoredVisualBump("2026-06-20", 0)["2026-06-20"], 0, "write without a window still returns the merged map");

{
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    store.set("cave:journal:visuals", "not json");
    assert.deepEqual(readStoredVisualBumps(), {}, "garbage storage reads as empty");
    store.set("cave:journal:visuals", JSON.stringify({ "2026-06-20": 2, "not-a-date": 1, "2026-06-21": "x" }));
    assert.deepEqual(readStoredVisualBumps(), { "2026-06-20": 2 }, "invalid dates and non-numeric bumps are dropped");

    writeStoredVisualBump("2026-06-22", 0);
    assert.deepEqual(readStoredVisualBumps(), { "2026-06-20": 2, "2026-06-22": 0 }, "writes merge with existing days");

    // Prune: the map keeps only the newest 90 days.
    store.clear();
    for (let i = 1; i <= 92; i++) {
      writeStoredVisualBump(`2026-01-${String(i).padStart(2, "0")}`, 0); // fake-but-valid slugs sort lexically
    }
    const kept = Object.keys(readStoredVisualBumps()).sort();
    assert.equal(kept.length, 90, "stored visuals prune to 90 days");
    assert.equal(kept[0], "2026-01-03", "the oldest days are the ones pruned");
  } finally {
    delete globalThis.window;
  }
}

console.log("journal-constellation.test.ts: ok");
