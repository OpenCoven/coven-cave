// @ts-nocheck
import assert from "node:assert/strict";
import { packEventColumns, DEFAULT_EVENT_MIN } from "./calendar-layout.ts";

// Build an InboxItem-ish object at HH:MM on a fixed date.
function at(id: string, h: number, m = 0) {
  const d = new Date(2026, 5, 13, h, m, 0, 0);
  return { id, kind: "reminder", title: id, status: "pending", createdAt: d.toISOString(), updatedAt: d.toISOString(), fireAt: d.toISOString(), recurrence: { type: "none" }, source: "user" };
}

// Non-overlapping events (far apart) → each gets its own single lane.
{
  const placed = packEventColumns([at("a", 9), at("b", 11), at("c", 14)]);
  assert.equal(placed.length, 3);
  for (const p of placed) assert.equal(p.lanes, 1, `${p.item.id} should be alone in its cluster`);
  assert.deepEqual(placed.map((p) => p.lane), [0, 0, 0]);
}

// Two events at the same time → 2 lanes, distinct lane indices, full cluster width.
{
  const placed = packEventColumns([at("a", 9, 0), at("b", 9, 15)]); // overlap (both 30-min slots)
  assert.equal(placed.length, 2);
  assert.ok(placed.every((p) => p.lanes === 2), "overlapping pair must widen to 2 lanes");
  assert.deepEqual(placed.map((p) => p.lane).sort(), [0, 1], "each takes a distinct lane");
}

// Three mutually-overlapping events → 3 lanes.
{
  const placed = packEventColumns([at("a", 9, 0), at("b", 9, 5), at("c", 9, 10)]);
  assert.ok(placed.every((p) => p.lanes === 3));
  assert.deepEqual(placed.map((p) => p.lane).sort(), [0, 1, 2]);
}

// A freed lane is reused: a,b overlap; c starts after a ends, so c reuses lane 0.
{
  const placed = packEventColumns([at("a", 9, 0), at("b", 9, 10), at("c", 9, 35)]);
  const byId = Object.fromEntries(placed.map((p) => [p.item.id, p]));
  // a (9:00–9:30) and b (9:10–9:40) overlap; c (9:35–10:05) overlaps b but not a.
  // All three are one transitive cluster → lanes 2, c reuses a's freed lane 0.
  assert.equal(byId.a.lanes, 2);
  assert.equal(byId.c.lane, 0, "c should reuse the lane freed by a");
}

// start/end reflect DEFAULT_EVENT_MIN.
{
  const [p] = packEventColumns([at("a", 8, 0)]);
  assert.equal(p.start, 8 * 60);
  assert.equal(p.end, 8 * 60 + DEFAULT_EVENT_MIN);
}

// Items with no date are dropped.
{
  const noDate = { id: "x", kind: "reminder", title: "x", status: "pending", createdAt: "", updatedAt: "", fireAt: null, firedAt: null, recurrence: { type: "none" }, source: "user" };
  assert.equal(packEventColumns([noDate]).length, 0);
}

console.log("calendar-layout.test.ts: all assertions passed");
