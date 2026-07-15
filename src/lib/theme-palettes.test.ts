// @ts-nocheck
import assert from "node:assert/strict";
import { THEME_IDS, THEME_META, getSwatches } from "./theme-palettes.ts";
import { LEGACY_THEME_RENAME, COVEN_THEME_KEY, COVEN_MODE_KEY } from "./theme-storage.ts";

// 19 themes, coven is the default (first).
assert.equal(THEME_IDS.length, 19);
assert.equal(THEME_IDS[0], "coven");
assert.deepEqual(
  [...THEME_IDS].sort(),
  [
    "bane",
    "beacon",
    "bloom",
    "claude",
    "claymorphism",
    "contrast",
    "coven",
    "dusk",
    "ember",
    "ghosty",
    "grove",
    "hex",
    "meatseeks",
    "mist",
    "pastel-dreams",
    "slate",
    "solstice",
    "tide",
    "trucker",
  ],
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

assert.equal(THEME_META.ghosty.name, "Ghosty");
assert.equal(THEME_META.ghosty.accentDark, "#a6a6a6");
assert.equal(THEME_META.ghosty.accentLight, "#808080");
assert.equal(THEME_META.claymorphism.name, "Claymorphism");
assert.equal(THEME_META.claude.name, "Claude");
assert.equal(THEME_META["pastel-dreams"].name, "Pastel Dreams");
assert.equal(THEME_META["pastel-dreams"].accentDark, "#c0aafd");
assert.equal(THEME_META["pastel-dreams"].accentLight, "#9377e6");
assert.equal(THEME_META.meatseeks.name, "Meatseeks");
assert.equal(THEME_META.trucker.name, "Trucker");
assert.equal(THEME_META.trucker.accentDark, "#21704a");
assert.equal(THEME_META.trucker.accentLight, "#005735");
assert.equal(THEME_META.contrast.name, "High Contrast");
assert.equal(THEME_META.contrast.accentDark, "#ffd60a");
assert.equal(THEME_META.contrast.accentLight, "#0f62fe");
assert.equal(THEME_META.beacon.name, "Beacon");
assert.equal(THEME_META.solstice.name, "Solstice");

// Storage keys are stable strings.
assert.equal(COVEN_THEME_KEY, "coven-theme");
assert.equal(COVEN_MODE_KEY, "coven-mode");

// Swatch trio completeness + derivation (moved from theme-color-editor.test.ts
// when the redundant "Customize colors" editor was removed).
for (const id of THEME_IDS) {
  const meta = THEME_META[id];
  assert.ok(meta.bgDark.length > 0, `${id} bgDark empty`);
  assert.ok(meta.bgLight.length > 0, `${id} bgLight empty`);
  for (const mode of ["dark", "light"]) {
    const s = getSwatches(id, mode);
    assert.ok(s.bg.length > 0, `${id} ${mode} bg empty`);
    assert.ok(s.accent.length > 0, `${id} ${mode} accent empty`);
    assert.ok(s.border.length > 0, `${id} ${mode} border empty`);
  }
}

// Preset seed stability: slate stays monochrome; border derives from accent.
assert.ok(getSwatches("slate", "dark").bg.includes("0.000"), "slate dark bg should be monochrome");
for (const id of ["coven", "tide", "ember"]) {
  const s = getSwatches(id, "dark");
  const accentHex = s.accent.replace(/^#/, "").slice(0, 6).toLowerCase();
  assert.ok(
    s.border.toLowerCase().includes(accentHex),
    `${id} border="${s.border}" should contain accent hex "${accentHex}"`,
  );
}

console.log("theme-palettes.test.ts OK");
