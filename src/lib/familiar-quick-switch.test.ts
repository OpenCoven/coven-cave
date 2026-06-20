// @ts-nocheck
import assert from "node:assert/strict";
import { computeQuickSwitch, QUICK_SWITCH_MAX } from "./familiar-quick-switch.ts";

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

console.log("familiar-quick-switch: all assertions passed");
