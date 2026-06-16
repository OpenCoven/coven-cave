// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generate,
  serializeSubset,
  SUBSET_URL,
  GLYPH_URL,
  loadPhosphorCollection,
} from "../../scripts/generate-icon-subset.mjs";

// ---------------------------------------------------------------------------
// The shipped icon set is the ICON_NAMES whitelist in icon.tsx, NOT the whole
// 4.5 MB Phosphor collection. This guards two things:
//   1. Every whitelisted name actually exists in Phosphor (no blank icons).
//   2. The committed ph-icons-subset.json matches what the generator would
//      produce — i.e. nobody added an ICON_NAMES entry without re-running
//      `node scripts/generate-icon-subset.mjs`.
// ---------------------------------------------------------------------------

const { subset, missing, names, glyphs } = generate();

assert.equal(
  missing.length,
  0,
  `Whitelisted icon name(s) not found in Phosphor (would render blank): ${missing.join(", ")}. ` +
    `Fix the name in icon.tsx ICON_NAMES (and any call sites).`,
);

const committed = readFileSync(SUBSET_URL, "utf8");
assert.equal(
  committed,
  serializeSubset(subset),
  "ph-icons-subset.json is stale — run `node scripts/generate-icon-subset.mjs` and commit the result.",
);

// The whole point: the committed subset must be a tiny fraction of the full
// Phosphor set, never the whole thing.
const full = loadPhosphorCollection();
const fullCount = Object.keys(full.icons).length;
const subsetCount = Object.keys(subset.icons).length;
assert.ok(fullCount > 5000, `sanity: upstream Phosphor should have thousands of icons, got ${fullCount}`);
assert.ok(
  subsetCount < 500,
  `Icon subset has ${subsetCount} icons — that's suspiciously large; the trim may have regressed to shipping the full set.`,
);
assert.ok(subsetCount === names.length, `every whitelisted name should resolve to one icon (${subsetCount} vs ${names.length})`);

// Spot-check: a used chrome icon is present; an UNUSED bare icon (no -fill, so
// not a glyph either) is absent from the chrome subset.
assert.ok(subset.icons["lightning-bold"], "a used icon (lightning-bold) must be in the chrome subset");
assert.ok(!subset.icons["airplane"], "an unused icon (airplane) must NOT be in the chrome subset");

// ---------------------------------------------------------------------------
// Glyph-picker catalog subset: the ~1.5k one-variant-per-base glyphs the
// familiar glyph picker offers, NOT the full ~9k Phosphor set.
// ---------------------------------------------------------------------------
const committedGlyphs = readFileSync(GLYPH_URL, "utf8");
assert.equal(
  committedGlyphs,
  serializeSubset(glyphs),
  "ph-glyph-catalog.json is stale — run `node scripts/generate-icon-subset.mjs` and commit the result.",
);

const glyphCount = Object.keys(glyphs.icons).length;
assert.ok(glyphCount > 1000 && glyphCount < 2500, `glyph catalog should be ~1.5k icons, got ${glyphCount}`);
assert.ok(glyphCount < fullCount / 2, `glyph catalog (${glyphCount}) must be far smaller than the full set (${fullCount})`);
// The picker prefers -fill: a base that has a fill variant ships only the fill.
assert.ok(glyphs.icons["airplane-fill"], "glyph catalog should offer the -fill variant (airplane-fill)");
assert.ok(!glyphs.icons["airplane-thin"], "glyph catalog must NOT ship unused weight variants (airplane-thin)");

console.log(`icon-subset.test.ts ✓ (chrome ${subsetCount}, glyphs ${glyphCount}, full ${fullCount})`);
