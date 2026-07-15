// @ts-nocheck
import assert from "node:assert/strict";
import {
  FONT_OPTIONS,
  FONT_PAIRS,
  DEFAULT_FONT_PAIR_ID,
  DEFAULT_FONT_ID,
  SERIF_FALLBACK,
  SANS_FALLBACK,
  MONO_FALLBACK,
  fontPairById,
  fontPairForFonts,
  fontOptionById,
  fontStack,
} from "./font-catalog.ts";

// Spec: 20–30 bundled options spanning all three slots (serif/sans/mono).
assert.ok(
  FONT_OPTIONS.length >= 20 && FONT_OPTIONS.length <= 30,
  `catalog must bundle 20-30 fonts (got ${FONT_OPTIONS.length})`,
);
const serif = FONT_OPTIONS.filter((o) => o.slot === "serif");
const sans = FONT_OPTIONS.filter((o) => o.slot === "sans");
const mono = FONT_OPTIONS.filter((o) => o.slot === "mono");
assert.ok(serif.length >= 2, "catalog needs at least a couple of serifs (display faces)");
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

// Coven canon defaults (DESIGN.md §4): EB Garamond + Inter + JetBrains Mono.
assert.equal(DEFAULT_FONT_ID.serif, "eb-garamond");
assert.equal(DEFAULT_FONT_ID.sans, "inter");
assert.equal(DEFAULT_FONT_ID.mono, "jetbrains-mono");
assert.equal(fontOptionById("eb-garamond")?.cssVar, "--font-eb-garamond");
assert.equal(fontOptionById("inter")?.cssVar, "--font-inter");
assert.equal(fontOptionById("jetbrains-mono")?.cssVar, "--font-jetbrains-mono");
assert.equal(fontOptionById("geist")?.cssVar, "--font-geist-sans");
assert.equal(fontOptionById("nope"), undefined);

// Font choices are curated pairs, not arbitrary serif/sans/mono cross-products.
assert.ok(FONT_PAIRS.length >= 5, "catalog exposes a useful set of curated font pairs");
const pairIds = new Set(FONT_PAIRS.map((pair) => pair.id));
assert.equal(pairIds.size, FONT_PAIRS.length, "font pair ids must be unique");
for (const pair of FONT_PAIRS) {
  assert.match(pair.id, /^[a-z0-9-]+$/, `pair id ${pair.id} must be kebab-case`);
  assert.ok(pair.label.length > 0, `label for pair ${pair.id}`);
  assert.equal(
    fontOptionById(pair.serifId)?.slot,
    "serif",
    `${pair.id} serif id must resolve to a serif font`,
  );
  assert.equal(
    fontOptionById(pair.sansId)?.slot,
    "sans",
    `${pair.id} sans id must resolve to a sans font`,
  );
  assert.equal(
    fontOptionById(pair.monoId)?.slot,
    "mono",
    `${pair.id} mono id must resolve to a mono font`,
  );
}
assert.equal(DEFAULT_FONT_PAIR_ID, "coven-canon");
assert.deepEqual(fontPairById(DEFAULT_FONT_PAIR_ID), {
  id: "coven-canon",
  label: "Coven Canon — EB Garamond · Inter · JetBrains Mono",
  serifId: DEFAULT_FONT_ID.serif,
  sansId: DEFAULT_FONT_ID.sans,
  monoId: DEFAULT_FONT_ID.mono,
});
assert.equal(
  fontPairForFonts(DEFAULT_FONT_ID.serif, DEFAULT_FONT_ID.sans, DEFAULT_FONT_ID.mono)?.id,
  DEFAULT_FONT_PAIR_ID,
);
assert.equal(
  fontPairForFonts("instrument-serif", "inter", "jetbrains-mono")?.id,
  "editorial-witch",
);
assert.equal(
  fontPairForFonts("eb-garamond", "inter", "space-mono"),
  undefined,
  "unapproved mixes are not accepted",
);

// Stacks chain the font var onto the slot fallback.
assert.equal(
  fontStack(fontOptionById("eb-garamond")),
  `var(--font-eb-garamond), ${SERIF_FALLBACK}`,
);
assert.equal(
  fontStack(fontOptionById("inter")),
  `var(--font-inter), ${SANS_FALLBACK}`,
);
assert.equal(
  fontStack(fontOptionById("jetbrains-mono")),
  `var(--font-jetbrains-mono), ${MONO_FALLBACK}`,
);

console.log("font-catalog tests passed");
