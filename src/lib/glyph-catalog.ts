/**
 * Catalogue of glyphs available in the picker.
 *
 * Two sources merge into one searchable list:
 *
 *   - `EMOJI_CATALOG` — a curated set of ~140 emojis that read well at
 *     small sizes and fit the "familiar persona" theme (creatures,
 *     mystical signs, simple symbols). Each entry has `char`, `name`,
 *     `category`, and `keywords` so search matches against intent
 *     ("cat", "wand", "fire") rather than the emoji codepoint name only.
 *
 *   - `phCollection.icons` — Phosphor's full ~1500-icon catalogue,
 *     loaded from the bundled `@iconify-json/ph` package, filtered to
 *     the "fill" variants for visual weight consistency with the rest
 *     of the cave chrome.
 *
 * Both shapes normalize to `GlyphCatalogEntry` so the picker can render
 * them with the same row component and search helper.
 */

import phCollection from "@iconify-json/ph/icons.json";

export type GlyphCatalogEntry = {
  /** Storage representation: emoji char OR `ph:...` icon name. */
  value: string;
  /** Discriminator used by the renderer + picker filters. */
  kind: "emoji" | "icon";
  /** Display name used when searching + shown in the preview row. */
  name: string;
  /** Category for the tab/section grouping. */
  category: string;
  /** Extra search keywords beyond `name`. */
  keywords: string[];
};

// ---------------------------------------------------------------------------
// Curated emoji
// ---------------------------------------------------------------------------

type EmojiSeed = {
  char: string;
  name: string;
  category: "Creatures" | "Mystical" | "Nature" | "Symbols" | "People" | "Objects";
  keywords?: string[];
};

const EMOJI_SEED: EmojiSeed[] = [
  // Creatures — first instinct for "familiar"
  { char: "🐈", name: "Cat", category: "Creatures", keywords: ["kitty", "kitten", "feline"] },
  { char: "🐈‍⬛", name: "Black cat", category: "Creatures", keywords: ["familiar", "witch"] },
  { char: "🐅", name: "Tiger", category: "Creatures" },
  { char: "🦁", name: "Lion", category: "Creatures" },
  { char: "🦊", name: "Fox", category: "Creatures", keywords: ["clever"] },
  { char: "🐺", name: "Wolf", category: "Creatures" },
  { char: "🐶", name: "Dog", category: "Creatures", keywords: ["puppy"] },
  { char: "🐰", name: "Rabbit", category: "Creatures" },
  { char: "🦝", name: "Raccoon", category: "Creatures" },
  { char: "🐻", name: "Bear", category: "Creatures" },
  { char: "🐼", name: "Panda", category: "Creatures" },
  { char: "🐨", name: "Koala", category: "Creatures" },
  { char: "🐹", name: "Hamster", category: "Creatures" },
  { char: "🐭", name: "Mouse", category: "Creatures" },
  { char: "🐿️", name: "Chipmunk", category: "Creatures", keywords: ["squirrel"] },
  { char: "🦦", name: "Otter", category: "Creatures" },
  { char: "🦔", name: "Hedgehog", category: "Creatures" },
  { char: "🦇", name: "Bat", category: "Creatures" },
  { char: "🐦", name: "Bird", category: "Creatures" },
  { char: "🦅", name: "Eagle", category: "Creatures" },
  { char: "🦉", name: "Owl", category: "Creatures", keywords: ["wise", "night"] },
  { char: "🐉", name: "Dragon", category: "Creatures", keywords: ["mythical"] },
  { char: "🐲", name: "Dragon face", category: "Creatures" },
  { char: "🦄", name: "Unicorn", category: "Creatures", keywords: ["mythical", "magic"] },
  { char: "🐙", name: "Octopus", category: "Creatures" },
  { char: "🦑", name: "Squid", category: "Creatures" },
  { char: "🦋", name: "Butterfly", category: "Creatures" },
  { char: "🐢", name: "Turtle", category: "Creatures" },
  { char: "🐍", name: "Snake", category: "Creatures" },
  { char: "🐠", name: "Tropical fish", category: "Creatures", keywords: ["fish"] },
  { char: "🐳", name: "Whale", category: "Creatures" },
  { char: "🐬", name: "Dolphin", category: "Creatures" },

  // Mystical
  { char: "🧙", name: "Mage", category: "Mystical", keywords: ["wizard", "witch"] },
  { char: "🧚", name: "Fairy", category: "Mystical" },
  { char: "🧛", name: "Vampire", category: "Mystical" },
  { char: "🧜", name: "Mermaid", category: "Mystical" },
  { char: "🧝", name: "Elf", category: "Mystical" },
  { char: "🧞", name: "Genie", category: "Mystical" },
  { char: "🧟", name: "Zombie", category: "Mystical" },
  { char: "👻", name: "Ghost", category: "Mystical", keywords: ["spirit", "haunt"] },
  { char: "👽", name: "Alien", category: "Mystical" },
  { char: "👾", name: "Alien monster", category: "Mystical", keywords: ["pixel"] },
  { char: "🤖", name: "Robot", category: "Mystical", keywords: ["ai", "machine"] },
  { char: "🪄", name: "Magic wand", category: "Mystical", keywords: ["wand", "spell"] },
  { char: "🔮", name: "Crystal ball", category: "Mystical", keywords: ["fortune", "divine"] },
  { char: "🕯️", name: "Candle", category: "Mystical" },
  { char: "📜", name: "Scroll", category: "Mystical", keywords: ["spell", "lore"] },
  { char: "🗝️", name: "Key", category: "Mystical" },
  { char: "⚱️", name: "Urn", category: "Mystical" },

  // Nature
  { char: "🌙", name: "Moon", category: "Nature", keywords: ["night", "crescent"] },
  { char: "☀️", name: "Sun", category: "Nature" },
  { char: "⭐", name: "Star", category: "Nature" },
  { char: "🌟", name: "Glowing star", category: "Nature", keywords: ["sparkle"] },
  { char: "✨", name: "Sparkles", category: "Nature", keywords: ["magic", "shimmer"] },
  { char: "💫", name: "Dizzy", category: "Nature", keywords: ["star", "spin"] },
  { char: "☁️", name: "Cloud", category: "Nature" },
  { char: "⚡", name: "Lightning", category: "Nature", keywords: ["bolt", "fast"] },
  { char: "🔥", name: "Fire", category: "Nature", keywords: ["flame", "hot"] },
  { char: "🌊", name: "Wave", category: "Nature", keywords: ["water", "ocean"] },
  { char: "🌿", name: "Herb", category: "Nature", keywords: ["plant", "leaf"] },
  { char: "🍀", name: "Four-leaf clover", category: "Nature", keywords: ["luck"] },
  { char: "🌸", name: "Cherry blossom", category: "Nature", keywords: ["flower"] },
  { char: "🌺", name: "Hibiscus", category: "Nature", keywords: ["flower"] },
  { char: "🌻", name: "Sunflower", category: "Nature", keywords: ["flower"] },
  { char: "🌷", name: "Tulip", category: "Nature", keywords: ["flower"] },
  { char: "🍄", name: "Mushroom", category: "Nature" },
  { char: "🌵", name: "Cactus", category: "Nature" },
  { char: "🌳", name: "Tree", category: "Nature" },

  // Symbols
  { char: "♠️", name: "Spade", category: "Symbols" },
  { char: "♥️", name: "Heart suit", category: "Symbols" },
  { char: "♦️", name: "Diamond suit", category: "Symbols" },
  { char: "♣️", name: "Club suit", category: "Symbols" },
  { char: "☯️", name: "Yin yang", category: "Symbols" },
  { char: "☮️", name: "Peace", category: "Symbols" },
  { char: "♾️", name: "Infinity", category: "Symbols" },
  { char: "⚛️", name: "Atom", category: "Symbols", keywords: ["science"] },
  { char: "🌀", name: "Cyclone", category: "Symbols", keywords: ["spiral", "swirl"] },
  { char: "❄️", name: "Snowflake", category: "Symbols" },
  { char: "🌈", name: "Rainbow", category: "Symbols" },
  { char: "💎", name: "Gem", category: "Symbols", keywords: ["diamond", "crystal"] },
  { char: "👁️", name: "Eye", category: "Symbols", keywords: ["see", "watch"] },
  { char: "🦴", name: "Bone", category: "Symbols" },
  { char: "🩸", name: "Drop of blood", category: "Symbols" },
  { char: "🧿", name: "Nazar amulet", category: "Symbols", keywords: ["evil eye", "protect"] },

  // People
  { char: "🥷", name: "Ninja", category: "People" },
  { char: "🧑‍💻", name: "Technologist", category: "People", keywords: ["dev", "code"] },
  { char: "🧑‍🎨", name: "Artist", category: "People" },
  { char: "🧑‍🚀", name: "Astronaut", category: "People", keywords: ["space"] },
  { char: "🧑‍🔬", name: "Scientist", category: "People" },
  { char: "🧑‍🌾", name: "Farmer", category: "People" },
  { char: "🧑‍🍳", name: "Cook", category: "People", keywords: ["chef"] },

  // Objects
  { char: "🪞", name: "Mirror", category: "Objects" },
  { char: "📖", name: "Open book", category: "Objects" },
  { char: "🪶", name: "Feather", category: "Objects", keywords: ["quill"] },
  { char: "🧪", name: "Test tube", category: "Objects", keywords: ["potion", "lab"] },
  { char: "🧬", name: "DNA", category: "Objects", keywords: ["genome"] },
  { char: "🎭", name: "Performing arts", category: "Objects", keywords: ["mask", "drama"] },
  { char: "🎨", name: "Artist palette", category: "Objects", keywords: ["paint"] },
  { char: "🎲", name: "Die", category: "Objects", keywords: ["chance", "random"] },
  { char: "🎯", name: "Direct hit", category: "Objects", keywords: ["target"] },
  { char: "🔭", name: "Telescope", category: "Objects" },
  { char: "📡", name: "Satellite", category: "Objects", keywords: ["signal"] },
  { char: "🛰️", name: "Satellite orbit", category: "Objects" },
  { char: "🗡️", name: "Dagger", category: "Objects", keywords: ["sword"] },
  { char: "🛡️", name: "Shield", category: "Objects", keywords: ["defense"] },
  { char: "🔱", name: "Trident", category: "Objects" },
];

const EMOJI_CATALOG: GlyphCatalogEntry[] = EMOJI_SEED.map((e) => ({
  value: e.char,
  kind: "emoji",
  name: e.name,
  category: e.category,
  keywords: e.keywords ?? [],
}));

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
  // Heuristic — Phosphor's published categories aren't in the JSON.
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
  // Strip Phosphor suffixes for the display name + keyword search; the actual
  // value still includes `-fill` etc. so the renderer gets the variant the
  // catalog picked.
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
  // Stable alphabetical so the grid order is predictable.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
})();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const ALL_EMOJI_ENTRIES = EMOJI_CATALOG;
export const ALL_ICON_ENTRIES = PHOSPHOR_CATALOG;

export type GlyphSearchOpts = {
  query?: string;
  kinds?: ("emoji" | "icon")[];
  category?: string;
};

/**
 * Search the merged catalog. Empty query returns the full set filtered by
 * `kinds` (and `category` if provided). Non-empty query does a substring
 * match against `name`, `category`, and `keywords`.
 */
export function searchGlyphs(opts: GlyphSearchOpts): GlyphCatalogEntry[] {
  const kinds = opts.kinds ?? ["emoji", "icon"];
  const q = (opts.query ?? "").trim().toLowerCase();
  const pool: GlyphCatalogEntry[] = [];
  if (kinds.includes("emoji")) pool.push(...ALL_EMOJI_ENTRIES);
  if (kinds.includes("icon")) pool.push(...ALL_ICON_ENTRIES);
  let filtered = pool;
  if (opts.category) {
    filtered = filtered.filter((e) => e.category === opts.category);
  }
  if (!q) return filtered;
  return filtered.filter((e) => {
    if (e.name.toLowerCase().includes(q)) return true;
    if (e.category.toLowerCase().includes(q)) return true;
    return e.keywords.some((k) => k.toLowerCase().includes(q));
  });
}

/** Distinct categories present in the chosen kinds, in display order. */
export function categoriesFor(kinds: ("emoji" | "icon")[]): string[] {
  const seen: string[] = [];
  const pool = kinds.includes("emoji")
    ? kinds.includes("icon")
      ? [...ALL_EMOJI_ENTRIES, ...ALL_ICON_ENTRIES]
      : ALL_EMOJI_ENTRIES
    : ALL_ICON_ENTRIES;
  for (const e of pool) {
    if (!seen.includes(e.category)) seen.push(e.category);
  }
  return seen;
}
