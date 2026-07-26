import {
  DEFAULT_CORNER_RADIUS,
  applyCornerRadius,
  readCornerRadius,
} from "./appearance-corner-radius";
import { applyBackdropToDocument, readBackdropPrefs } from "./cave-backdrop";
import { applyFontPair, readFontPairPref } from "./font-storage";
import { DEFAULT_FONT_PAIR_ID } from "./font-catalog";
import { DEFAULT_READING_ALIGN, applyReadingAlign, readReadingAlign } from "./reading-align";
import { DEFAULT_READING_HYPHENS, applyReadingHyphens, readReadingHyphens } from "./reading-hyphens";
import { DEFAULT_READING_LEADING, applyReadingLeading, readReadingLeading } from "./reading-leading";
import { DEFAULT_READING_TRACKING, applyReadingTracking, readReadingTracking } from "./reading-tracking";
import { DEFAULT_READING_WEIGHT, applyReadingWeight, readReadingWeight } from "./reading-weight";
import { DEFAULT_READING_WIDTH, applyReadingWidth, readReadingWidth } from "./reading-width";
import { applyScreenScale, readScreenScale } from "./screen-magnification";
import { readAppPreferences } from "./app-preferences";
import type { CustomThemeData } from "./preferences-schema";

function cssName(name: string): string {
  return name.startsWith("--") ? name : `--${name}`;
}

/** Remove only properties introduced by the previous custom theme. */
export function clearCustomThemeVariables(
  custom: CustomThemeData | null = readAppPreferences().appearance.theme.custom,
): void {
  if (typeof document === "undefined" || !custom) return;
  const names = new Set<string>();
  for (const group of [custom.cssVars.theme, custom.cssVars.light, custom.cssVars.dark]) {
    if (!group) continue;
    for (const name of Object.keys(group)) names.add(cssName(name));
  }
  const root = document.documentElement;
  for (const name of names) root.style.removeProperty(name);
}

/**
 * Re-layer independent user choices after a theme switch. Defaults remove
 * their inline override and intentionally reveal the selected preset's CSS.
 */
export function reapplyIndependentAppearance(
  options: { preserveCustomDefaults?: boolean } = {},
): void {
  const preserveDefaults = options.preserveCustomDefaults === true;
  const fontPair = readFontPairPref();
  if (!preserveDefaults || fontPair.id !== DEFAULT_FONT_PAIR_ID) applyFontPair(fontPair.id);
  applyScreenScale(readScreenScale(), { persist: false });
  const leading = readReadingLeading();
  if (!preserveDefaults || leading !== DEFAULT_READING_LEADING) applyReadingLeading(leading, { persist: false });
  const tracking = readReadingTracking();
  if (!preserveDefaults || tracking !== DEFAULT_READING_TRACKING) applyReadingTracking(tracking, { persist: false });
  const align = readReadingAlign();
  if (!preserveDefaults || align !== DEFAULT_READING_ALIGN) applyReadingAlign(align, { persist: false });
  const width = readReadingWidth();
  if (!preserveDefaults || width !== DEFAULT_READING_WIDTH) applyReadingWidth(width, { persist: false });
  const weight = readReadingWeight();
  if (!preserveDefaults || weight !== DEFAULT_READING_WEIGHT) applyReadingWeight(weight, { persist: false });
  const hyphens = readReadingHyphens();
  if (!preserveDefaults || hyphens !== DEFAULT_READING_HYPHENS) applyReadingHyphens(hyphens, { persist: false });
  const corner = readCornerRadius();
  if (!preserveDefaults || corner !== DEFAULT_CORNER_RADIUS) applyCornerRadius(corner, { persist: false });
  const backdrop = readBackdropPrefs();
  if (!preserveDefaults || backdrop.enabled) applyBackdropToDocument(backdrop, undefined);
}
