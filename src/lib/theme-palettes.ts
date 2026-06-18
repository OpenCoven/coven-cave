/**
 * 10-theme roster metadata + swatch lookup for the appearance settings UI.
 * The actual palette CSS lives in `src/app/globals.css`; this module
 * mirrors the accent values and a representative background swatch
 * per (theme, mode) so the settings grid can preview each card.
 */

import type { Mode } from "./theme-storage.ts";

export const THEME_IDS = [
  "coven",
  "tide",
  "grove",
  "ember",
  "bloom",
  "dusk",
  "mist",
  "hex",
  "bane",
  "slate",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeMeta {
  name: string;
  description: string;
  hue: number;
  accentDark: string;
  accentLight: string;
  /** Background swatch (CSS color string) for the preview card, per mode. */
  bgDark: string;
  bgLight: string;
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  coven: {
    name: "Coven",
    description: "Lavender-inked grimoire. The house default; mind the runes.",
    hue: 293, accentDark: "#9a8ecd", accentLight: "#6F62A8",
    bgDark: "oklch(0.13 0.022 293)", bgLight: "oklch(0.975 0.012 293)",
  },
  tide: {
    name: "Tide",
    description: "Moontide blue. Cold, deliberate, mostly underwater.",
    hue: 245, accentDark: "#5FB0FF", accentLight: "#2E6FC9",
    bgDark: "oklch(0.10 0.035 245)", bgLight: "oklch(0.97 0.020 240)",
  },
  grove: {
    name: "Grove",
    description: "Hexenwald moss. Damp, patient, full of teeth.",
    hue: 150, accentDark: "#7FD89F", accentLight: "#2A8050",
    bgDark: "oklch(0.10 0.040 150)", bgLight: "oklch(0.97 0.018 145)",
  },
  ember: {
    name: "Vintage Paper",
    description: "Sun-faded folio. Warm tan ink steeped into aged paper; unhurried.",
    hue: 66, accentDark: "#c0a080", accentLight: "#a67c52",
    bgDark: "oklch(0.2747 0.0139 57.6523)", bgLight: "oklch(0.9582 0.0152 90.2357)",
  },
  bloom: {
    name: "Bloom",
    description: "Bewitching-blood rose. Saccharine looks; thorned hands.",
    hue: 20, accentDark: "#F09BB1", accentLight: "#BE506E",
    bgDark: "oklch(0.115 0.040 20)", bgLight: "oklch(0.975 0.018 20)",
  },
  dusk: {
    name: "Dusk",
    description: "Witching-hour magenta. The veil thins; so does your patience.",
    hue: 322, accentDark: "#E175FF", accentLight: "#9930C2",
    bgDark: "oklch(0.10 0.050 322)", bgLight: "oklch(0.97 0.022 325)",
  },
  mist: {
    name: "Mist",
    description: "Scrying-pool teal. Cold as a question without an answer.",
    hue: 198, accentDark: "#6BD8D3", accentLight: "#1A857F",
    bgDark: "oklch(0.09 0.030 198)", bgLight: "oklch(0.97 0.015 195)",
  },
  hex: {
    name: "Hex",
    description: "Bloodletter's brand. The mark that doesn't wash off.",
    hue: 25, accentDark: "#E04848", accentLight: "#A41C24",
    bgDark: "oklch(0.09 0.060 25)", bgLight: "oklch(0.97 0.022 25)",
  },
  bane: {
    name: "Bane",
    description: "Wolfsbane bloom. Bright; deeply unwise.",
    hue: 125, accentDark: "#A5F050", accentLight: "#4A7C18",
    bgDark: "oklch(0.09 0.050 125)", bgLight: "oklch(0.97 0.022 125)",
  },
  slate: {
    name: "Slate",
    description: "Ink-and-bone monochrome. No color. No mercy.",
    hue: 270, accentDark: "#B8B8C2", accentLight: "#525258",
    bgDark: "oklch(0.05 0.000 0)", bgLight: "oklch(0.985 0.000 0)",
  },
};

export interface SwatchTuple {
  bg: string;
  accent: string;
  border: string;
}

export function getSwatches(id: ThemeId, mode: Mode): SwatchTuple {
  const m = THEME_META[id];
  return mode === "light"
    ? { bg: m.bgLight, accent: m.accentLight, border: `${m.accentLight}40` }
    : { bg: m.bgDark, accent: m.accentDark, border: `${m.accentDark}40` };
}
