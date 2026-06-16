// Generate a TRIMMED Phosphor icon collection containing only the icons the
// app actually references (the `ICON_NAMES` whitelist in src/lib/icon.tsx).
//
// Why: src/lib/icon.tsx used to `import phCollection from
// "@iconify-json/ph/icons.json"` and `addCollection(...)` the WHOLE set —
// ~4.5 MB / 9000+ icons — into the client bundle, even though only ~240 are
// used. A static JSON data import can't be tree-shaken, so the full file
// shipped. This emits `src/lib/ph-icons-subset.json` (committed) holding just
// the used icons + the aliases they resolve through.
//
// Run: `node scripts/generate-icon-subset.mjs` (wired into `prebuild`).
// The committed output is kept in sync by src/lib/icon-subset.test.ts.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const ICON_TSX_URL = new URL("../src/lib/icon.tsx", import.meta.url);
export const SUBSET_URL = new URL("../src/lib/ph-icons-subset.json", import.meta.url);
export const GLYPH_URL = new URL("../src/lib/ph-glyph-catalog.json", import.meta.url);

// Variant suffixes Phosphor uses; stripping them gives the base glyph name.
const GLYPH_VARIANT_RE = /-fill$|-bold$|-duotone$|-light$|-thin$/;

/** Load the full upstream Phosphor collection. */
export function loadPhosphorCollection() {
  return require("@iconify-json/ph/icons.json");
}

/** Extract the `ph:<name>` whitelist from icon.tsx without importing the
 *  (client-only) module. The array is a flat list of quoted literals. */
export function usedIconNames(iconTsxText) {
  const block = iconTsxText.match(/ICON_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  if (!block) throw new Error("Could not find the ICON_NAMES array in icon.tsx");
  const names = [...block[1].matchAll(/"ph:([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

/**
 * Build a minimal IconifyJSON collection for `names`. Resolves alias chains so
 * the parent glyph is included. Returns { subset, missing } — `missing` lists
 * any whitelisted name that doesn't exist in Phosphor (a typo to fix).
 */
export function buildSubset(collection, names) {
  const icons = {};
  const aliases = {};
  const missing = [];

  for (const name of names) {
    if (collection.icons?.[name]) {
      icons[name] = collection.icons[name];
      continue;
    }
    // Follow the alias chain to its concrete parent icon.
    let cursor = name;
    let resolved = false;
    const seen = new Set();
    while (collection.aliases?.[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      aliases[cursor] = collection.aliases[cursor];
      cursor = collection.aliases[cursor].parent;
      if (collection.icons?.[cursor]) {
        icons[cursor] = collection.icons[cursor];
        resolved = true;
        break;
      }
    }
    if (!resolved) missing.push(name);
  }

  // Deterministic key order so the committed file diffs cleanly.
  const sortedIcons = {};
  for (const k of Object.keys(icons).sort()) sortedIcons[k] = icons[k];
  const sortedAliases = {};
  for (const k of Object.keys(aliases).sort()) sortedAliases[k] = aliases[k];

  const subset = { prefix: collection.prefix, icons: sortedIcons };
  if (Object.keys(sortedAliases).length) subset.aliases = sortedAliases;
  if (typeof collection.width === "number") subset.width = collection.width;
  if (typeof collection.height === "number") subset.height = collection.height;
  return { subset, missing };
}

/**
 * Build the glyph-picker catalog subset: exactly the glyphs the familiar glyph
 * picker offers — ONE variant per base name, preferring `-fill` for visual
 * weight (mirrors the dedup in src/lib/glyph-catalog.ts). Shipping only these
 * ~1.5k glyphs instead of all ~9k icons keeps every picker choice while
 * dropping the unused weight/duotone/thin variants nobody can select.
 */
export function buildGlyphSubset(collection) {
  const names = Object.keys(collection.icons ?? {});
  const byBase = new Map();
  for (const n of names) {
    const base = n.replace(GLYPH_VARIANT_RE, "");
    if (n.endsWith("-fill")) byBase.set(base, n);
    else if (!byBase.has(base)) byBase.set(base, n);
  }
  const chosen = [...byBase.values()];
  const icons = {};
  for (const n of chosen.sort()) icons[n] = collection.icons[n];
  const subset = { prefix: collection.prefix, icons };
  if (typeof collection.width === "number") subset.width = collection.width;
  if (typeof collection.height === "number") subset.height = collection.height;
  return subset;
}

/** Canonical serialization shared by the generator and the freshness test. */
export function serializeSubset(subset) {
  return JSON.stringify(subset) + "\n";
}

/** Full pipeline: read icon.tsx + Phosphor, return both subsets. */
export function generate() {
  const iconTsx = readFileSync(ICON_TSX_URL, "utf8");
  const names = usedIconNames(iconTsx);
  const collection = loadPhosphorCollection();
  const { subset, missing } = buildSubset(collection, names);
  const glyphs = buildGlyphSubset(collection);
  return { subset, missing, names, glyphs };
}

// CLI entry — write both files (and hard-fail on unknown icon names).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { subset, missing, names, glyphs } = generate();
  if (missing.length) {
    console.error(`✗ ${missing.length} icon name(s) not found in Phosphor: ${missing.join(", ")}`);
    process.exit(1);
  }
  writeFileSync(SUBSET_URL, serializeSubset(subset));
  writeFileSync(GLYPH_URL, serializeSubset(glyphs));
  const kb = (s) => (Buffer.byteLength(serializeSubset(s)) / 1024).toFixed(1);
  console.log(`✓ ph-icons-subset.json:  ${names.length} chrome icons, ${kb(subset)} KB`);
  console.log(`✓ ph-glyph-catalog.json: ${Object.keys(glyphs.icons).length} picker glyphs, ${kb(glyphs)} KB`);
}
