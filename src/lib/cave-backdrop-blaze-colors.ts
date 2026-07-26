/**
 * Blaze backdrop colors — derived from ONE theme token (cave-99s9).
 *
 * The smoke takes `--accent-presence` directly; the sparks sit 70% toward a
 * neutral grey so they read as pale embers over any of the 21 palettes × 2
 * modes (the same single-token philosophy as the app's state tints). When the
 * accent can't be parsed, the exact Canvas UI playground values apply.
 */

import { parseThemeColor } from "@/lib/theme-contrast";

export type BlazeRgb = [number, number, number];

/** Canvas UI playground values — fallback colors. */
export const BLAZE_FALLBACK_SPARK: BlazeRgb = [0.6314, 0.6314, 0.6902];
export const BLAZE_FALLBACK_SMOKE: BlazeRgb = [0.5451, 0.3608, 0.9647];

/** Exact effect options from the Canvas UI playground — do not tune casually;
 *  these are the user-approved look (spec 2026-07-23-blaze-backdrop-design). */
export const BLAZE_OPTIONS = {
  height: 0.75,
  distortion: 0.5,
  distortionScale: 1,
  speed: 0.5,
  sparks: 0.75,
  sparkDensity: 0.75,
  sparkSize: 0.75,
  layers: 5,
  smoke: 1,
  glow: 0.5,
} as const;

const SPARK_GREY = 0.66;
const SPARK_MIX = 0.7;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Derive the fire palette from the accent CSS color (any theme syntax). */
export function blazeColorsFromAccent(accentCss: string): {
  sparkColor: BlazeRgb;
  smokeColor: BlazeRgb;
} {
  const accent = parseThemeColor(accentCss);
  if (!accent) return { sparkColor: BLAZE_FALLBACK_SPARK, smokeColor: BLAZE_FALLBACK_SMOKE };
  const ember = (channel: number) => clamp01(channel * (1 - SPARK_MIX) + SPARK_GREY * SPARK_MIX);
  return {
    smokeColor: [clamp01(accent.r), clamp01(accent.g), clamp01(accent.b)],
    sparkColor: [ember(accent.r), ember(accent.g), ember(accent.b)],
  };
}
