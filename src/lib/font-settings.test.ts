// @ts-nocheck
import assert from "node:assert/strict";
import {
  FONT_OPTIONS,
  DEFAULT_FONT_ID,
  SANS_FALLBACK,
  MONO_FALLBACK,
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

// Defaults are the existing Geist pair, so a fresh profile changes nothing.
assert.equal(DEFAULT_FONT_ID.sans, "geist");
assert.equal(DEFAULT_FONT_ID.mono, "geist-mono");
assert.equal(fontOptionById("geist")?.cssVar, "--font-geist-sans");
assert.equal(fontOptionById("geist-mono")?.cssVar, "--font-geist-mono");
assert.equal(fontOptionById("nope"), undefined);

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
