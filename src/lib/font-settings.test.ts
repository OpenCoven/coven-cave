// @ts-nocheck
import assert from "node:assert/strict";
import {
  FONT_OPTIONS,
  FONT_PAIRS,
  DEFAULT_FONT_PAIR_ID,
  DEFAULT_FONT_ID,
  SANS_FALLBACK,
  MONO_FALLBACK,
  fontPairById,
  fontPairForFonts,
  fontOptionById,
  fontStack,
} from "./font-catalog.ts";

// Spec: 15–25 bundled options spanning both slots.
assert.ok(
  FONT_OPTIONS.length >= 15 && FONT_OPTIONS.length <= 25,
  `catalog must bundle 15-25 fonts (got ${FONT_OPTIONS.length})`,
);
const sans = FONT_OPTIONS.filter((o) => o.slot === "sans");
const mono = FONT_OPTIONS.filter((o) => o.slot === "mono");
assert.ok(sans.length >= 8, "catalog needs a real sans selection");
assert.ok(mono.length >= 5, "catalog needs a real mono selection");

// Ids are unique and kebab-case; every entry carries a CSS var.
const ids = new Set(FONT_OPTIONS.map((o) => o.id));
assert.equal(ids.size, FONT_OPTIONS.length, "font ids must be unique");
for (const o of FONT_OPTIONS) {
  assert.match(o.id, /^[a-z0-9-]+$/, `id ${o.id} must be kebab-case`);
  assert.match(o.cssVar, /^--font-[a-z0-9-]+$/, `cssVar for ${o.id}`);
  assert.ok(o.label.length > 0, `label for ${o.id}`);
}

// Defaults are the Coven-branded pair: Geist Sans for UI, JetBrains Mono for code.
assert.equal(DEFAULT_FONT_ID.sans, "geist");
assert.equal(DEFAULT_FONT_ID.mono, "jetbrains-mono");
assert.equal(fontOptionById("geist")?.cssVar, "--font-geist-sans");
assert.equal(fontOptionById("geist-mono")?.cssVar, "--font-geist-mono");
assert.equal(fontOptionById("nope"), undefined);

// Font choices are curated pairs, not arbitrary sans/mono cross-products.
assert.ok(FONT_PAIRS.length >= 5, "catalog exposes a useful set of curated font pairs");
const pairIds = new Set(FONT_PAIRS.map((pair) => pair.id));
assert.equal(pairIds.size, FONT_PAIRS.length, "font pair ids must be unique");
for (const pair of FONT_PAIRS) {
  assert.match(pair.id, /^[a-z0-9-]+$/, `pair id ${pair.id} must be kebab-case`);
  assert.ok(pair.label.length > 0, `label for pair ${pair.id}`);
  assert.equal(fontOptionById(pair.sansId)?.slot, "sans", `${pair.id} sans id must resolve to a sans font`);
  assert.equal(fontOptionById(pair.monoId)?.slot, "mono", `${pair.id} mono id must resolve to a mono font`);
}
assert.equal(DEFAULT_FONT_PAIR_ID, "geist-jetbrains");
assert.deepEqual(fontPairById(DEFAULT_FONT_PAIR_ID), {
  id: "geist-jetbrains",
  label: "Geist + JetBrains Mono",
  sansId: DEFAULT_FONT_ID.sans,
  monoId: DEFAULT_FONT_ID.mono,
});
assert.equal(fontPairForFonts(DEFAULT_FONT_ID.sans, DEFAULT_FONT_ID.mono)?.id, DEFAULT_FONT_PAIR_ID);
assert.equal(fontPairForFonts("manrope", "space-mono")?.id, "manrope-space-mono");
assert.equal(fontPairForFonts("manrope", "jetbrains-mono"), undefined, "unapproved mixes are not accepted");

// Stacks chain the font var onto the slot fallback.
assert.equal(
  fontStack(fontOptionById("geist")),
  `var(--font-geist-sans), ${SANS_FALLBACK}`,
);
assert.equal(
  fontStack(fontOptionById("geist-mono")),
  `var(--font-geist-mono), ${MONO_FALLBACK}`,
);

console.log("font-catalog tests passed");
