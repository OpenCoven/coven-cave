// @ts-nocheck
import assert from "node:assert/strict";
import { THEME_IDS, THEME_META, getSwatches } from "./theme-palettes.ts";
import { LEGACY_THEME_RENAME, COVEN_THEME_KEY, COVEN_MODE_KEY } from "./theme-storage.ts";

// 10 themes, coven is the default (first).
assert.equal(THEME_IDS.length, 10);
assert.equal(THEME_IDS[0], "coven");
assert.deepEqual(
  [...THEME_IDS].sort(),
  ["bane", "bloom", "coven", "dusk", "ember", "grove", "hex", "mist", "slate", "tide"],
);

// Every theme has a name, hue, and both accent values.
for (const id of THEME_IDS) {
  const meta = THEME_META[id];
  assert.ok(meta, `metadata for ${id}`);
  assert.equal(typeof meta.name, "string");
  assert.equal(typeof meta.hue, "number");
  assert.match(meta.accentDark, /^#[0-9A-Fa-f]{6}$/, `accentDark for ${id}`);
  assert.match(meta.accentLight, /^#[0-9A-Fa-f]{6}$/, `accentLight for ${id}`);
}

// getSwatches returns distinct background swatches per mode.
for (const id of THEME_IDS) {
  const dark = getSwatches(id, "dark");
  const light = getSwatches(id, "light");
  assert.notEqual(dark.bg, light.bg, `${id} bg swatch differs by mode`);
  assert.equal(dark.accent, THEME_META[id].accentDark);
  assert.equal(light.accent, THEME_META[id].accentLight);
}

// Legacy rename map covers all 4 old ids.
assert.deepEqual(LEGACY_THEME_RENAME, {
  "mood-c": "coven",
  "sky": "tide",
  "orchid": "dusk",
  "midnight": "slate",
});

// Inverse coverage: no stray THEME_META keys outside THEME_IDS.
assert.deepEqual(
  Object.keys(THEME_META).sort(),
  [...THEME_IDS].sort(),
  "THEME_META keys must exactly match THEME_IDS",
);

// Storage keys are stable strings.
assert.equal(COVEN_THEME_KEY, "coven-theme");
assert.equal(COVEN_MODE_KEY, "coven-mode");

console.log("theme-palettes.test.ts OK");
