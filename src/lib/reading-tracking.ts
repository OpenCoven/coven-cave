/**
 * Reading letter-spacing (tracking) for long-form prose.
 *
 * Scoped to the shared `.cave-md` markdown surface (chat messages, the library
 * doc reader, the memory view) via the `--cave-reading-tracking` CSS var. It
 * deliberately does NOT touch the app's other ~74 letter-spacing declarations
 * (uppercase eyebrows, heading tightening), which are intentional.
 *
 * Mirrors src/lib/reading-leading.ts: a small enum persisted in localStorage
 * and applied to <html>. The default ("normal") removes the override so
 * `.cave-md`'s built-in 0 fallback applies.
 */
export const READING_TRACKING_KEY = "cave:reading-tracking";

export const READING_TRACKING_OPTIONS = ["normal", "wide", "wider"] as const;

export type ReadingTracking = (typeof READING_TRACKING_OPTIONS)[number];

export const DEFAULT_READING_TRACKING: ReadingTracking = "normal";

/** letter-spacing value per level. `normal` matches `.cave-md`'s default (0). */
export const READING_TRACKING_VALUES: Record<ReadingTracking, string> = {
  normal: "0",
  wide: "0.02em",
  wider: "0.04em",
};

export function normalizeReadingTracking(value: unknown): ReadingTracking {
  return READING_TRACKING_OPTIONS.includes(value as ReadingTracking)
    ? (value as ReadingTracking)
    : DEFAULT_READING_TRACKING;
}

export function readReadingTracking(): ReadingTracking {
  if (typeof window === "undefined") return DEFAULT_READING_TRACKING;
  try {
    return normalizeReadingTracking(window.localStorage.getItem(READING_TRACKING_KEY));
  } catch {
    return DEFAULT_READING_TRACKING;
  }
}

/**
 * Apply the level: set `--cave-reading-tracking` on <html> (or remove it for
 * the default so the stylesheet fallback wins) and persist the choice.
 */
export function applyReadingTracking(level: ReadingTracking) {
  if (typeof document === "undefined") return;
  const normalized = normalizeReadingTracking(level);
  const root = document.documentElement;
  if (normalized === DEFAULT_READING_TRACKING) {
    root.style.removeProperty("--cave-reading-tracking");
  } else {
    root.style.setProperty("--cave-reading-tracking", READING_TRACKING_VALUES[normalized]);
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(READING_TRACKING_KEY, normalized);
  } catch {
    /* ignore unavailable storage */
  }
}
