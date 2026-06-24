// @ts-nocheck
import assert from "node:assert/strict";
import { familiarTint, familiarAccent } from "./familiar-color.ts";

// ── familiarTint: deterministic, distinct, in-gamut ──
assert.equal(familiarTint("nova"), familiarTint("nova"), "same seed → same tint");
assert.notEqual(familiarTint("nova"), familiarTint("sage"), "distinct seeds → distinct tints");
{
  const t = familiarTint("cody");
  assert.match(t, /^oklch\(0\.72 0\.13 \d{1,3}\)$/, "well-formed oklch");
  const hue = Number(t.match(/ (\d{1,3})\)$/)[1]);
  assert.ok(hue >= 0 && hue < 360, "hue in [0,360)");
}

// ── familiarAccent: explicit colour wins, default falls back to a derived hue ──
assert.equal(familiarAccent("#ff8800", "x"), "#ff8800", "an explicit colour is used as-is");
assert.equal(familiarAccent("var(--accent-presence)", "x"), familiarTint("x"), "the shared default → derived tint");
assert.equal(familiarAccent(null, "x"), familiarTint("x"), "no colour → derived tint");
assert.equal(familiarAccent(undefined, "y"), familiarTint("y"), "undefined → derived tint keyed by id");

console.log("familiar-color.test.ts: ok");
