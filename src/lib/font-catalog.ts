/**
 * Bundled font registry. Every entry corresponds to a `next/font/google`
 * instance declared in src/app/fonts.ts whose `.variable` class is spread
 * onto <html> by the root layout — so each cssVar resolves anywhere in the
 * app. Unselected fonts cost nothing at runtime: they're declared with
 * `preload: false` and @font-face only downloads files for families that
 * rendered text actually uses.
 */
export type FontSlot = "sans" | "mono";

export type FontOption = {
  id: string;
  label: string;
  slot: FontSlot;
  cssVar: string;
};

export type FontPair = {
  id: string;
  label: string;
  sansId: string;
  monoId: string;
};

export const SANS_FALLBACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MONO_FALLBACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const FONT_OPTIONS: FontOption[] = [
  // ── Sans (UI) ──
  { id: "geist", label: "Geist", slot: "sans", cssVar: "--font-geist-sans" },
  { id: "inter", label: "Inter", slot: "sans", cssVar: "--font-inter" },
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
  { id: "geist-mono", label: "Geist Mono", slot: "mono", cssVar: "--font-geist-mono" },
  { id: "jetbrains-mono", label: "JetBrains Mono", slot: "mono", cssVar: "--font-jetbrains-mono" },
  { id: "fira-code", label: "Fira Code", slot: "mono", cssVar: "--font-fira-code" },
  { id: "source-code-pro", label: "Source Code Pro", slot: "mono", cssVar: "--font-source-code-pro" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", slot: "mono", cssVar: "--font-ibm-plex-mono" },
  { id: "roboto-mono", label: "Roboto Mono", slot: "mono", cssVar: "--font-roboto-mono" },
  { id: "space-mono", label: "Space Mono", slot: "mono", cssVar: "--font-space-mono" },
  { id: "inconsolata", label: "Inconsolata", slot: "mono", cssVar: "--font-inconsolata" },
];

export const DEFAULT_FONT_ID: Record<FontSlot, string> = {
  // Geist Sans: already preloaded by Next.js, renders immediately — clean neutral UI
  sans: "geist",
  // JetBrains Mono: canonical mono per OpenCoven DESIGN.md / brand/ui/typography.css
  // Best-in-class readability for code, terminal output, and dense labels at small sizes
  mono: "jetbrains-mono",
};

export const FONT_PAIRS: FontPair[] = [
  {
    id: "geist-jetbrains",
    label: "Geist + JetBrains Mono",
    sansId: "geist",
    monoId: "jetbrains-mono",
  },
  {
    id: "inter-geist-mono",
    label: "Inter + Geist Mono",
    sansId: "inter",
    monoId: "geist-mono",
  },
  {
    id: "manrope-space-mono",
    label: "Manrope + Space Mono",
    sansId: "manrope",
    monoId: "space-mono",
  },
  {
    id: "public-sans-roboto-mono",
    label: "Public Sans + Roboto Mono",
    sansId: "public-sans",
    monoId: "roboto-mono",
  },
  {
    id: "ibm-plex-pair",
    label: "IBM Plex Sans + IBM Plex Mono",
    sansId: "ibm-plex-sans",
    monoId: "ibm-plex-mono",
  },
  {
    id: "source-pair",
    label: "Source Sans 3 + Source Code Pro",
    sansId: "source-sans-3",
    monoId: "source-code-pro",
  },
  {
    id: "dm-sans-fira-code",
    label: "DM Sans + Fira Code",
    sansId: "dm-sans",
    monoId: "fira-code",
  },
];

export const DEFAULT_FONT_PAIR_ID = "geist-jetbrains";

export function fontOptionById(id: string): FontOption | undefined {
  return FONT_OPTIONS.find((o) => o.id === id);
}

export function fontPairById(id: string): FontPair | undefined {
  return FONT_PAIRS.find((pair) => pair.id === id);
}

export function fontPairForFonts(sansId: string, monoId: string): FontPair | undefined {
  return FONT_PAIRS.find((pair) => pair.sansId === sansId && pair.monoId === monoId);
}

export function slotFallback(slot: FontSlot): string {
  return slot === "sans" ? SANS_FALLBACK : MONO_FALLBACK;
}

export function fontStack(option: FontOption): string {
  return `var(${option.cssVar}), ${slotFallback(option.slot)}`;
}
