/**
 * Catalogue of glyphs available in the picker.
 *
 * Source: Phosphor's full ~1500-icon catalogue, loaded from the bundled
 * `@iconify-json/ph` package, filtered to the "fill" variants for visual
 * weight consistency with the rest of the cave chrome.
 *
 * Emoji entries used to live here as well, but Cave's UI standardised on
 * Phosphor for chrome neutrality. The renderer in `familiar-glyph.tsx`
 * still draws emoji values defensively so users with saved emoji avatars
 * from earlier versions keep working — they just can't pick a new one
 * from the picker.
 */

import phCollection from "@iconify-json/ph/icons.json";

export type GlyphCatalogEntry = {
  /** Storage representation: `ph:...` icon name. */
  value: string;
  /** Discriminator used by the renderer + picker filters. */
  kind: "icon";
  /** Display name used when searching + shown in the preview row. */
  name: string;
  /** Category for the tab/section grouping. */
  category: string;
  /** Extra search keywords beyond `name`. */
  keywords: string[];
};

// ---------------------------------------------------------------------------
// Phosphor — fill variants only
//
// Phosphor names follow a pattern: `name`, `name-bold`, `name-fill`,
// `name-duotone`, `name-light`, `name-thin`. We pick the `-fill` variant
// for visual weight consistency; if a glyph has no fill variant, we keep
// the plain name. Categories inside Phosphor (Animals, Brand, Communication,
// Design, …) aren't surfaced in the bundled JSON, so we derive a rough
// grouping from the icon name prefix below.
// ---------------------------------------------------------------------------

type PhosphorCollection = {
  icons: Record<string, unknown>;
};

function categorizePhosphor(name: string): string {
  if (/(cat|dog|bird|fish|paw|bone|bug|spider|butterfly|rabbit|cow|horse|dolphin|fox|owl)/.test(name)) return "Animals";
  if (/(heart|smiley|user|person|ghost|skull|baby|hand)/.test(name)) return "People";
  if (/(sun|moon|cloud|fire|drop|leaf|tree|flower|mountain|lightning|wind|snowflake|tornado)/.test(name)) return "Nature";
  if (/(star|sparkle|circle|square|diamond|triangle|hexagon|heart|infinity|asterisk|crosshair)/.test(name)) return "Shapes";
  if (/(wrench|hammer|gear|magnifying|wand|key|lock|shield|sword|compass|map)/.test(name)) return "Tools";
  if (/(book|note|pencil|paintbrush|palette|guitar|piano|microphone|camera|video)/.test(name)) return "Creative";
  if (/(rocket|globe|planet|atom|gauge|graph|chart|brain|cpu|robot)/.test(name)) return "Science";
  if (/(chat|envelope|bell|phone|share)/.test(name)) return "Communication";
  return "All icons";
}

function entryForPhosphor(rawName: string): GlyphCatalogEntry | null {
  const base = rawName
    .replace(/-fill$|-bold$|-duotone$|-light$|-thin$/, "")
    .replace(/-/g, " ");
  return {
    value: `ph:${rawName}`,
    kind: "icon",
    name: base,
    category: categorizePhosphor(rawName),
    keywords: rawName.split("-"),
  };
}

const PHOSPHOR_NAMES: string[] = Object.keys((phCollection as PhosphorCollection).icons ?? {});

// Prefer fill; if a fill doesn't exist for a base name, fall back to the bare
// name. Build a set keyed on the base name so each icon appears once.
const PHOSPHOR_CATALOG: GlyphCatalogEntry[] = (() => {
  const byBase = new Map<string, string>();
  for (const n of PHOSPHOR_NAMES) {
    const base = n.replace(/-fill$|-bold$|-duotone$|-light$|-thin$/, "");
    if (n.endsWith("-fill")) {
      byBase.set(base, n);
    } else if (!byBase.has(base)) {
      byBase.set(base, n);
    }
  }
  const entries: GlyphCatalogEntry[] = [];
  for (const name of byBase.values()) {
    const e = entryForPhosphor(name);
    if (e) entries.push(e);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
})();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const ALL_ICON_ENTRIES = PHOSPHOR_CATALOG;

export type GlyphSearchOpts = {
  query?: string;
  category?: string;
};

/**
 * Search the icon catalog. Empty query returns the full set (optionally
 * filtered by category). Non-empty query does a substring match against
 * `name`, `category`, and `keywords`.
 */
export function searchGlyphs(opts: GlyphSearchOpts): GlyphCatalogEntry[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  let pool = ALL_ICON_ENTRIES;
  if (opts.category) {
    pool = pool.filter((e) => e.category === opts.category);
  }
  if (!q) return pool;
  return pool.filter((e) => {
    if (e.name.toLowerCase().includes(q)) return true;
    if (e.category.toLowerCase().includes(q)) return true;
    return e.keywords.some((k) => k.toLowerCase().includes(q));
  });
}

/** Distinct categories present in the catalog, in display order. */
export function categories(): string[] {
  const seen: string[] = [];
  for (const e of ALL_ICON_ENTRIES) {
    if (!seen.includes(e.category)) seen.push(e.category);
  }
  return seen;
}
