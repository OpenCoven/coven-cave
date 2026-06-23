/**
 * Storage keys + legacy id-rename map for the theme system.
 *
 * Extracted so the rename map is unit-testable. NOTE: the inline
 * <ThemeScript> body in src/components/theme-script.tsx inlines the
 * same key strings and rename map verbatim (the script body is a
 * string literal that runs before module code resolves, so it cannot
 * import). Keep both in sync.
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
/** Stored color-mode preference; "system" follows the OS, resolving to Mode. */
export type ModePref = Mode | "system";
