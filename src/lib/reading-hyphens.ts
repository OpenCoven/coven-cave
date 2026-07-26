/**
 * Reading hyphenation (automatic word-breaking with hyphens for long-form
 * prose). Pairs with Justify alignment to avoid large inter-word gaps.
 *
 * Scoped to the shared `.cave-md` markdown surface (chat messages, memory
 * view) via the `--cave-reading-hyphens` CSS var. The
 * default ("off") removes the override so prose uses `manual` (no auto
 * hyphenation). Requires `lang` on <html> (set to "en"); the app's WebKit
 * webview also needs `-webkit-hyphens`, set alongside `hyphens` in CSS.
 *
 * Mirrors src/lib/reading-weight.ts.
 */
export const READING_HYPHENS_KEY = "cave:reading-hyphens";

export const READING_HYPHENS_OPTIONS = ["off", "on"] as const;

export type ReadingHyphens = (typeof READING_HYPHENS_OPTIONS)[number];

export const DEFAULT_READING_HYPHENS: ReadingHyphens = "off";

/** CSS `hyphens` value per level. `off` matches the default `manual`. */
export const READING_HYPHENS_VALUES: Record<ReadingHyphens, string> = {
  off: "manual",
  on: "auto",
};

export function normalizeReadingHyphens(value: unknown): ReadingHyphens {
  return READING_HYPHENS_OPTIONS.includes(value as ReadingHyphens)
    ? (value as ReadingHyphens)
    : DEFAULT_READING_HYPHENS;
}

export function readReadingHyphens(): ReadingHyphens {
  const central = normalizeReadingHyphens(readAppPreferences().appearance.reading.hyphens);
  if (central !== DEFAULT_READING_HYPHENS || readAppPreferences().initialized) return central;
  if (typeof window === "undefined") return DEFAULT_READING_HYPHENS;
  try {
    return normalizeReadingHyphens(window.localStorage.getItem(READING_HYPHENS_KEY));
  } catch {
    return DEFAULT_READING_HYPHENS;
  }
}

/**
 * Apply the level: set `--cave-reading-hyphens` on <html> (or remove it for the
 * default so `.cave-md`'s `manual` fallback applies) and persist the choice.
 */
export function applyReadingHyphens(level: ReadingHyphens, options: { persist?: boolean } = {}) {
  if (typeof document === "undefined") return;
  const normalized = normalizeReadingHyphens(level);
  if (options.persist !== false) {
    updateAppPreferences({ appearance: { reading: { hyphens: normalized } } });
  }
  const root = document.documentElement;
  if (normalized === DEFAULT_READING_HYPHENS) {
    root.style.removeProperty("--cave-reading-hyphens");
  } else {
    root.style.setProperty("--cave-reading-hyphens", READING_HYPHENS_VALUES[normalized]);
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(READING_HYPHENS_KEY, normalized);
  } catch {
    /* ignore unavailable storage */
  }
}
import { readAppPreferences, updateAppPreferences } from "./app-preferences.ts";
