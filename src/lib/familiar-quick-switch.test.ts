// @ts-nocheck
import assert from "node:assert/strict";
import { computeQuickSwitch, QUICK_SWITCH_MAX, getPins, setPins, togglePin } from "./familiar-quick-switch.ts";

const fam = (id, extra = {}) => ({ id, last_seen: undefined, ...extra });

// Pins come first, in pin order, regardless of recency.
{
  const familiars = [fam("a"), fam("b"), fam("c"), fam("d")];
  const out = computeQuickSwitch(familiars, { pins: ["c", "a"], lastUsed: { b: 100, d: 200 } });
  assert.deepEqual(out.map((f) => f.id), ["c", "a", "d", "b"], "pins first (in pin order), then recency");
}

// The active familiar is always surfaced, right after pins.
{
  const familiars = [fam("a"), fam("b"), fam("c")];
  const out = computeQuickSwitch(familiars, { pins: ["a"], activeId: "c", lastUsed: { b: 999 } });
  assert.deepEqual(out.map((f) => f.id), ["a", "c", "b"], "active comes after pins, before plain recents");
}

// Recency uses cave last-used first, then daemon last_seen as a fallback.
{
  const familiars = [
    fam("old", { last_seen: "2020-01-01T00:00:00Z" }),
    fam("newer", { last_seen: "2024-01-01T00:00:00Z" }),
    fam("tracked"),
  ];
  const out = computeQuickSwitch(familiars, { lastUsed: { tracked: Date.now() } });
  assert.deepEqual(out.map((f) => f.id), ["tracked", "newer", "old"], "last-used beats last_seen; newer last_seen wins");
}

// Stable input order breaks ties when there's no recency signal at all.
{
  const familiars = [fam("a"), fam("b"), fam("c")];
  const out = computeQuickSwitch(familiars, {});
  assert.deepEqual(out.map((f) => f.id), ["a", "b", "c"], "no signal → input order preserved");
}

// Capped at max; default is QUICK_SWITCH_MAX (6).
{
  const familiars = Array.from({ length: 10 }, (_, i) => fam(`f${i}`));
  assert.equal(computeQuickSwitch(familiars, {}).length, QUICK_SWITCH_MAX, "defaults to QUICK_SWITCH_MAX");
  assert.equal(QUICK_SWITCH_MAX, 6, "default strip size is 6");
  assert.equal(computeQuickSwitch(familiars, { max: 3 }).length, 3, "honors explicit max");
  assert.deepEqual(computeQuickSwitch(familiars, { max: 0 }), [], "max 0 → empty");
}

// scope "pinned" → ONLY the pinned familiars, in pin order; no active/recent fill.
{
  const familiars = [fam("a"), fam("b"), fam("c"), fam("d")];
  const out = computeQuickSwitch(familiars, {
    pins: ["c", "a"],
    activeId: "d",
    lastUsed: { b: 999, d: 500 },
    scope: "pinned",
  });
  assert.deepEqual(out.map((f) => f.id), ["c", "a"], "pinned scope shows only pinned, in pin order");
}

// scope "pinned" with no pins → empty strip (even with an active familiar).
{
  const familiars = [fam("a"), fam("b")];
  const out = computeQuickSwitch(familiars, { activeId: "a", scope: "pinned" });
  assert.deepEqual(out, [], "pinned scope + no pins → empty");
}

// scope "pinned" still honors max and drops unknown pin ids.
{
  const familiars = [fam("a"), fam("b"), fam("c")];
  assert.deepEqual(
    computeQuickSwitch(familiars, { pins: ["a", "b", "c"], max: 2, scope: "pinned" }).map((f) => f.id),
    ["a", "b"],
    "pinned scope respects max",
  );
  assert.deepEqual(
    computeQuickSwitch(familiars, { pins: ["ghost", "b"], scope: "pinned" }).map((f) => f.id),
    ["b"],
    "pinned scope skips unknown pin ids",
  );
}

// scope "all" (the default) is unchanged — pinned, then active, then recency.
{
  const familiars = [fam("a"), fam("b"), fam("c")];
  const out = computeQuickSwitch(familiars, { pins: ["a"], activeId: "c", lastUsed: { b: 999 }, scope: "all" });
  assert.deepEqual(out.map((f) => f.id), ["a", "c", "b"], "all scope keeps active + recency fill");
}

// Pins/active referencing absent familiars are ignored (no crash, no holes).
{
  const familiars = [fam("a"), fam("b")];
  const out = computeQuickSwitch(familiars, { pins: ["ghost", "a"], activeId: "alsogone" });
  assert.deepEqual(out.map((f) => f.id), ["a", "b"], "unknown pin/active ids are skipped");
}

// No duplicates even when an id is pinned AND active AND recent.
{
  const familiars = [fam("a"), fam("b")];
  const out = computeQuickSwitch(familiars, { pins: ["a"], activeId: "a", lastUsed: { a: 5 } });
  assert.deepEqual(out.map((f) => f.id), ["a", "b"], "an id appears at most once");
}

// setPins replaces the whole pin list in the given order (drag-to-reorder),
// deduping; togglePin removes a pin. (No window in Node → state lives in the
// module cache, which is what the hooks read.)
{
  setPins(["c", "a", "b"]);
  assert.deepEqual(getPins(), ["c", "a", "b"], "setPins establishes a new order");
  setPins(["b", "c", "a"]);
  assert.deepEqual(getPins(), ["b", "c", "a"], "setPins reorders");
  setPins(["a", "a", "b"]);
  assert.deepEqual(getPins(), ["a", "b"], "setPins dedupes");
  togglePin("a");
  assert.deepEqual(getPins(), ["b"], "togglePin removes an existing pin");
  setPins([]);
  assert.deepEqual(getPins(), [], "setPins can clear all pins");
}

console.log("familiar-quick-switch: all assertions passed");
