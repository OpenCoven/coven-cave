/**
 * Storage keys + legacy id-rename map for the theme system.
 *
 * Extracted so the rename map is unit-testable and so the inline
 * <ThemeScript> body can stay a self-contained string while still
 * referencing the canonical keys via build-time substitution.
 */

export const COVEN_THEME_KEY = "coven-theme";
export const COVEN_MODE_KEY = "coven-mode";
export const COVEN_CUSTOM_THEME_KEY = "coven-custom-theme";

/**
 * Renames from the dark-only preset roster to the 8-theme roster.
 * Applied one-shot on first run after upgrade.
 */
export const LEGACY_THEME_RENAME: Record<string, string> = {
  "mood-c": "coven",
  "sky": "tide",
  "orchid": "dusk",
  "midnight": "slate",
};

export type Mode = "light" | "dark";
