/**
 * Max reading width (the line-length / measure cap for long-form prose).
 *
 * Scoped to the shared `.cave-md` markdown surface (chat messages, the library
 * doc reader, the memory view) via the `--cave-reading-width` CSS var, which
 * caps `.cave-md`'s max-width. The default ("full") removes the override so
 * `.cave-md` fills its container as before.
 *
 * Mirrors src/lib/reading-align.ts: a small enum persisted in localStorage and
 * applied to <html>.
 */
export const READING_WIDTH_KEY = "cave:reading-width";

export const READING_WIDTH_OPTIONS = ["full", "medium", "narrow"] as const;

export type ReadingWidth = (typeof READING_WIDTH_OPTIONS)[number];

export const DEFAULT_READING_WIDTH: ReadingWidth = "full";

/** max-width value per level. `full` is unset (the rule falls back to `none`). */
export const READING_WIDTH_VALUES: Record<ReadingWidth, string> = {
  full: "none",
  medium: "680px",
  narrow: "560px",
};

export function normalizeReadingWidth(value: unknown): ReadingWidth {
  return READING_WIDTH_OPTIONS.includes(value as ReadingWidth)
    ? (value as ReadingWidth)
    : DEFAULT_READING_WIDTH;
}

export function readReadingWidth(): ReadingWidth {
  if (typeof window === "undefined") return DEFAULT_READING_WIDTH;
  try {
    return normalizeReadingWidth(window.localStorage.getItem(READING_WIDTH_KEY));
  } catch {
    return DEFAULT_READING_WIDTH;
  }
}

/**
 * Apply the level: set `--cave-reading-width` on <html> (or remove it for the
 * default so `.cave-md`'s `none` fallback applies) and persist the choice.
 */
export function applyReadingWidth(level: ReadingWidth) {
  if (typeof document === "undefined") return;
  const normalized = normalizeReadingWidth(level);
  const root = document.documentElement;
  if (normalized === DEFAULT_READING_WIDTH) {
    root.style.removeProperty("--cave-reading-width");
  } else {
    root.style.setProperty("--cave-reading-width", READING_WIDTH_VALUES[normalized]);
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(READING_WIDTH_KEY, normalized);
  } catch {
    /* ignore unavailable storage */
  }
}
