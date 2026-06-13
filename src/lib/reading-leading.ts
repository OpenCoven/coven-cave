/**
 * Reading line-spacing (line-height for long-form prose).
 *
 * Scoped to the shared `.cave-md` markdown surface (chat messages, the library
 * doc reader, the memory view) via the `--cave-reading-leading` CSS var — it
 * deliberately does NOT touch the app's other ~83 hard-coded line-heights
 * (icons, chips, headings), which are intentionally tight.
 *
 * Mirrors src/lib/screen-magnification.ts: a small enum persisted in
 * localStorage and applied to <html>. The default ("normal") removes the
 * override so `.cave-md`'s built-in 1.7 fallback applies.
 */
export const READING_LEADING_KEY = "cave:reading-leading";

export const READING_LEADING_OPTIONS = ["compact", "normal", "relaxed"] as const;

export type ReadingLeading = (typeof READING_LEADING_OPTIONS)[number];

export const DEFAULT_READING_LEADING: ReadingLeading = "normal";

/** Line-height value per level. `normal` matches `.cave-md`'s default (1.7). */
export const READING_LEADING_VALUES: Record<ReadingLeading, number> = {
  compact: 1.45,
  normal: 1.7,
  relaxed: 2.0,
};

export function normalizeReadingLeading(value: unknown): ReadingLeading {
  return READING_LEADING_OPTIONS.includes(value as ReadingLeading)
    ? (value as ReadingLeading)
    : DEFAULT_READING_LEADING;
}

export function readReadingLeading(): ReadingLeading {
  if (typeof window === "undefined") return DEFAULT_READING_LEADING;
  try {
    return normalizeReadingLeading(window.localStorage.getItem(READING_LEADING_KEY));
  } catch {
    return DEFAULT_READING_LEADING;
  }
}

/**
 * Apply the level: set `--cave-reading-leading` on <html> (or remove it for the
 * default so the stylesheet fallback wins) and persist the choice.
 */
export function applyReadingLeading(level: ReadingLeading) {
  if (typeof document === "undefined") return;
  const normalized = normalizeReadingLeading(level);
  const root = document.documentElement;
  if (normalized === DEFAULT_READING_LEADING) {
    root.style.removeProperty("--cave-reading-leading");
  } else {
    root.style.setProperty("--cave-reading-leading", String(READING_LEADING_VALUES[normalized]));
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(READING_LEADING_KEY, normalized);
  } catch {
    /* ignore unavailable storage */
  }
}
