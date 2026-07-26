/**
 * Bundled font registry. Every entry corresponds to a `next/font/google`
 * instance declared in src/app/fonts.ts whose `.variable` class is spread
 * onto <html> by the root layout — so each cssVar resolves anywhere in the
 * app. Unselected fonts cost nothing at runtime: they're declared with
 * `preload: false` and @font-face only downloads files for families that
 * rendered text actually uses.
 *
 * The catalog now has three slots (per OpenCoven DESIGN.md §4):
 *   - "serif" — display / headline / hero face; identity moments
 *   - "sans"  — UI / body / prose face; everything you read
 *   - "mono"  — code / terminal / label face; everything you inspect
 */
export type FontSlot = "serif" | "sans" | "mono";

export type FontOption = {
  id: string;
  label: string;
  slot: FontSlot;
  cssVar: string;
};

export type FontPair = {
  id: string;
  label: string;
  serifId: string;
  sansId: string;
  monoId: string;
};

export const SERIF_FALLBACK =
  '"Iowan Old Style", Georgia, "Times New Roman", serif';
export const SANS_FALLBACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MONO_FALLBACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const FONT_OPTIONS: FontOption[] = [
  // ── Serif (display / hero / identity) ──
  { id: "eb-garamond", label: "EB Garamond", slot: "serif", cssVar: "--font-eb-garamond" },
  { id: "instrument-serif", label: "Instrument Serif", slot: "serif", cssVar: "--font-instrument-serif" },
  { id: "fraunces", label: "Fraunces", slot: "serif", cssVar: "--font-fraunces" },
  // ── Sans (UI / body) ──
  { id: "inter", label: "Inter", slot: "sans", cssVar: "--font-inter" },
  { id: "geist", label: "Geist", slot: "sans", cssVar: "--font-geist-sans" },
  { id: "roboto", label: "Roboto", slot: "sans", cssVar: "--font-roboto" },
  { id: "open-sans", label: "Open Sans", slot: "sans", cssVar: "--font-open-sans" },
  { id: "lato", label: "Lato", slot: "sans", cssVar: "--font-lato" },
  { id: "source-sans-3", label: "Source Sans 3", slot: "sans", cssVar: "--font-source-sans-3" },
  { id: "noto-sans", label: "Noto Sans", slot: "sans", cssVar: "--font-noto-sans" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", slot: "sans", cssVar: "--font-ibm-plex-sans" },
  { id: "work-sans", label: "Work Sans", slot: "sans", cssVar: "--font-work-sans" },
  { id: "dm-sans", label: "DM Sans", slot: "sans", cssVar: "--font-dm-sans" },
  { id: "manrope", label: "Manrope", slot: "sans", cssVar: "--font-manrope" },
  { id: "figtree", label: "Figtree", slot: "sans", cssVar: "--font-figtree" },
  { id: "public-sans", label: "Public Sans", slot: "sans", cssVar: "--font-public-sans" },
  // ── Mono (code / terminal) ──
  { id: "jetbrains-mono", label: "JetBrains Mono", slot: "mono", cssVar: "--font-jetbrains-mono" },
  { id: "geist-mono", label: "Geist Mono", slot: "mono", cssVar: "--font-geist-mono" },
  { id: "fira-code", label: "Fira Code", slot: "mono", cssVar: "--font-fira-code" },
  { id: "source-code-pro", label: "Source Code Pro", slot: "mono", cssVar: "--font-source-code-pro" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", slot: "mono", cssVar: "--font-ibm-plex-mono" },
  { id: "roboto-mono", label: "Roboto Mono", slot: "mono", cssVar: "--font-roboto-mono" },
  { id: "space-mono", label: "Space Mono", slot: "mono", cssVar: "--font-space-mono" },
  { id: "inconsolata", label: "Inconsolata", slot: "mono", cssVar: "--font-inconsolata" },
];

export const DEFAULT_FONT_ID: Record<FontSlot, string> = {
  // EB Garamond: canonical Coven display face — classical old-style serif,
  // "grimoire not corporate" — DESIGN.md §4.
  serif: "eb-garamond",
  // Inter: canonical Coven UI face — highly legible sans, works at every
  // size. Replaces Geist as the shipped default (Geist stays selectable).
  sans: "inter",
  // JetBrains Mono: canonical mono per OpenCoven DESIGN.md / brand/ui/typography.css.
  // Best-in-class readability for code, terminal output, and dense labels at small sizes.
  mono: "jetbrains-mono",
};

export const FONT_PAIRS: FontPair[] = [
  {
    id: "coven-canon",
    label: "Coven Canon — EB Garamond · Inter · JetBrains Mono",
    serifId: "eb-garamond",
    sansId: "inter",
    monoId: "jetbrains-mono",
  },
  {
    id: "editorial-witch",
    label: "Editorial Witch — Instrument Serif · Inter · JetBrains Mono",
    serifId: "instrument-serif",
    sansId: "inter",
    monoId: "jetbrains-mono",
  },
  {
    id: "shapeshifter",
    label: "Shapeshifter — Fraunces · Inter · JetBrains Mono",
    serifId: "fraunces",
    sansId: "inter",
    monoId: "jetbrains-mono",
  },
  {
    id: "geist-jetbrains",
    label: "Geist + JetBrains Mono (legacy)",
    serifId: "eb-garamond",
    sansId: "geist",
    monoId: "jetbrains-mono",
  },
  {
    id: "ibm-plex-pair",
    label: "IBM Plex Sans + IBM Plex Mono",
    serifId: "eb-garamond",
    sansId: "ibm-plex-sans",
    monoId: "ibm-plex-mono",
  },
  {
    id: "source-pair",
    label: "Source Sans 3 + Source Code Pro",
    serifId: "eb-garamond",
    sansId: "source-sans-3",
    monoId: "source-code-pro",
  },
];

export const DEFAULT_FONT_PAIR_ID = "coven-canon";

export function fontOptionById(id: string): FontOption | undefined {
  return FONT_OPTIONS.find((o) => o.id === id);
}

export function fontPairById(id: string): FontPair | undefined {
  return FONT_PAIRS.find((pair) => pair.id === id);
}

export function fontPairForFonts(serifId: string, sansId: string, monoId: string): FontPair | undefined {
  return FONT_PAIRS.find(
    (pair) => pair.serifId === serifId && pair.sansId === sansId && pair.monoId === monoId,
  );
}

export function slotFallback(slot: FontSlot): string {
  if (slot === "serif") return SERIF_FALLBACK;
  if (slot === "sans") return SANS_FALLBACK;
  return MONO_FALLBACK;
}

export function fontStack(option: FontOption): string {
  return `var(${option.cssVar}), ${slotFallback(option.slot)}`;
}
