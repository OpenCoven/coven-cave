/**
 * 8-theme roster metadata + swatch lookup for the appearance settings UI.
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
    description: "OpenCoven violet — the default lavender field manual",
    hue: 293, accentDark: "#9A8ECD", accentLight: "#6F62A8",
    bgDark: "oklch(0.07 0.004 293)", bgLight: "oklch(0.99 0.003 293)",
  },
  tide: {
    name: "Tide",
    description: "Cool slate-blue, daybreak accent",
    hue: 245, accentDark: "#6DA9FF", accentLight: "#3D7DD8",
    bgDark: "oklch(0.07 0.012 245)", bgLight: "oklch(0.99 0.005 245)",
  },
  grove: {
    name: "Grove",
    description: "Forest green, calm and grounded",
    hue: 145, accentDark: "#6DCB8E", accentLight: "#2F8C58",
    bgDark: "oklch(0.07 0.010 145)", bgLight: "oklch(0.99 0.005 145)",
  },
  ember: {
    name: "Ember",
    description: "Warm amber, focused-work feel",
    hue: 60, accentDark: "#E8A85C", accentLight: "#B5752A",
    bgDark: "oklch(0.07 0.010 60)", bgLight: "oklch(0.99 0.006 60)",
  },
  bloom: {
    name: "Bloom",
    description: "Soft rose, friendly",
    hue: 15, accentDark: "#E88FA5", accentLight: "#C25A78",
    bgDark: "oklch(0.07 0.010 15)", bgLight: "oklch(0.99 0.005 15)",
  },
  dusk: {
    name: "Dusk",
    description: "Magenta pink-violet",
    hue: 330, accentDark: "#D26BFF", accentLight: "#9F3FCE",
    bgDark: "oklch(0.07 0.014 330)", bgLight: "oklch(0.99 0.006 330)",
  },
  mist: {
    name: "Mist",
    description: "Teal/cyan, clinical",
    hue: 195, accentDark: "#5DD0CB", accentLight: "#1E938E",
    bgDark: "oklch(0.07 0.010 195)", bgLight: "oklch(0.99 0.005 195)",
  },
  slate: {
    name: "Slate",
    description: "Zero-chroma neutral",
    hue: 270, accentDark: "#A0A0AB", accentLight: "#5C5C66",
    bgDark: "oklch(0.07 0.000 270)", bgLight: "oklch(0.99 0.000 270)",
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
