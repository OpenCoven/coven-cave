/**
 * Reading text-alignment for long-form prose.
 *
 * Scoped to the shared `.cave-md` markdown surface (chat messages, memory
 * view) via the `--cave-reading-align` CSS var. It
 * deliberately does NOT touch the app's other ~59 text-align declarations
 * (buttons, labels, layout), which are intentional.
 *
 * Mirrors src/lib/reading-tracking.ts: a small enum persisted in localStorage
 * and applied to <html>. The default ("left") removes the override so
 * `.cave-md`'s built-in left fallback applies.
 */
export const READING_ALIGN_KEY = "cave:reading-align";

export const READING_ALIGN_OPTIONS = ["left", "justify"] as const;

export type ReadingAlign = (typeof READING_ALIGN_OPTIONS)[number];

export const DEFAULT_READING_ALIGN: ReadingAlign = "left";

export function normalizeReadingAlign(value: unknown): ReadingAlign {
  return READING_ALIGN_OPTIONS.includes(value as ReadingAlign)
    ? (value as ReadingAlign)
    : DEFAULT_READING_ALIGN;
}

export function readReadingAlign(): ReadingAlign {
  const central = normalizeReadingAlign(readAppPreferences().appearance.reading.align);
  if (central !== DEFAULT_READING_ALIGN || readAppPreferences().initialized) return central;
  if (typeof window === "undefined") return DEFAULT_READING_ALIGN;
  try {
    return normalizeReadingAlign(window.localStorage.getItem(READING_ALIGN_KEY));
  } catch {
    return DEFAULT_READING_ALIGN;
  }
}

/**
 * Apply the alignment: set `--cave-reading-align` on <html> (or remove it for
 * the default so the stylesheet fallback wins) and persist the choice.
 */
export function applyReadingAlign(align: ReadingAlign, options: { persist?: boolean } = {}) {
  if (typeof document === "undefined") return;
  const normalized = normalizeReadingAlign(align);
  if (options.persist !== false) {
    updateAppPreferences({ appearance: { reading: { align: normalized } } });
  }
  const root = document.documentElement;
  if (normalized === DEFAULT_READING_ALIGN) {
    root.style.removeProperty("--cave-reading-align");
  } else {
    root.style.setProperty("--cave-reading-align", normalized);
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(READING_ALIGN_KEY, normalized);
  } catch {
    /* ignore unavailable storage */
  }
}
import { readAppPreferences, updateAppPreferences } from "./app-preferences.ts";
