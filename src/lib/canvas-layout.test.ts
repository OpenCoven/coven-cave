// @ts-nocheck
import assert from "node:assert/strict";

import {
  autoArrange,
  bandForX,
  bandIndexForStatus,
  bandLeft,
  BAND_WIDTH,
  CANVAS_BANDS,
  pruneOrphanPositions,
  resolvePositions,
} from "./canvas-layout.ts";

// ── bandForX: which status owns a world-x coordinate ───────────────────────

assert.equal(bandForX(0), "inbox", "x=0 is the first (Inbox) band");
assert.equal(bandForX(BAND_WIDTH * 0.5), "inbox", "mid-first-band stays Inbox");
assert.equal(bandForX(BAND_WIDTH * 1.5), CANVAS_BANDS[1], "second band is Backlog");
assert.equal(
  bandForX(BAND_WIDTH * (CANVAS_BANDS.length + 5)),
  CANVAS_BANDS[CANVAS_BANDS.length - 1],
  "coordinates past the last band clamp to Done",
);
assert.equal(bandForX(-500), "inbox", "negative x clamps to the first band");

// ── bandIndexForStatus is the inverse of the bands array ───────────────────

CANVAS_BANDS.forEach((status, i) => {
  assert.equal(bandIndexForStatus(status), i, `${status} maps to band ${i}`);
});
// Unknown / legacy statuses default to the first band rather than throwing.
assert.equal(bandIndexForStatus("nonsense"), 0, "unknown status defaults to Inbox band");

// ── autoArrange: tidy grid, one column per band, stacked vertically ────────

const arranged = autoArrange([
  { id: "a", status: "inbox" },
  { id: "b", status: "inbox" },
  { id: "c", status: "done" },
]);
assert.ok(arranged.a && arranged.b && arranged.c, "every card gets a position");
assert.equal(arranged.a.x, arranged.b.x, "same-band cards share an x column");
assert.ok(arranged.b.y > arranged.a.y, "second card in a band stacks below the first");
const doneBand = bandIndexForStatus("done");
assert.ok(arranged.c.x >= bandLeft(doneBand), "done card sits in the Done band column");

// ── resolvePositions: keep saved coords, auto-place newcomers ──────────────

const resolved = resolvePositions(
  [
    { id: "saved", status: "backlog" },
    { id: "fresh", status: "backlog" },
  ],
  { saved: { x: 999, y: 42 } },
);
assert.deepEqual(resolved.saved, { x: 999, y: 42 }, "saved position is preserved verbatim");
assert.ok(resolved.fresh, "card without a saved position is auto-placed");
assert.ok(
  resolved.fresh.y > resolved.saved.y || resolved.fresh.x !== resolved.saved.x,
  "auto-placed newcomer does not land exactly on the saved card",
);

// A non-finite saved coordinate is treated as missing and re-placed.
const repaired = resolvePositions([{ id: "x", status: "inbox" }], { x: { x: NaN, y: 0 } });
assert.ok(Number.isFinite(repaired.x.x) && Number.isFinite(repaired.x.y), "NaN positions are repaired");

// ── pruneOrphanPositions: drop layout for deleted cards ────────────────────

const pruned = pruneOrphanPositions({ keep: { x: 1, y: 1 }, gone: { x: 2, y: 2 } }, ["keep"]);
assert.deepEqual(pruned, { keep: { x: 1, y: 1 } }, "positions for absent cards are dropped");

console.log("canvas-layout.test.ts ✓");
