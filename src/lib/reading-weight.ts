/**
 * Reading font-weight (the base weight of long-form prose body text).
 *
 * Scoped to the shared `.cave-md` markdown surface (chat messages, the library
 * doc reader, the memory view) via the `--cave-reading-weight` CSS var. Bold
 * (`.cave-md strong`, 650) and headings (650/600) set their own weights, so
 * this only shifts normal text. The default ("normal") removes the override.
 *
 * Note: variable catalog fonts (Geist, Inter, …) render any weight true; static
 * ones (Lato, IBM Plex, Space Mono) only loaded fixed weights, so off-axis
 * values may be browser-synthesized for those families.
 *
 * Mirrors src/lib/reading-width.ts.
 */
export const READING_WEIGHT_KEY = "cave:reading-weight";

export const READING_WEIGHT_OPTIONS = ["light", "normal", "medium"] as const;

export type ReadingWeight = (typeof READING_WEIGHT_OPTIONS)[number];

export const DEFAULT_READING_WEIGHT: ReadingWeight = "normal";

/** font-weight value per level. `normal` matches the inherited body weight (400). */
export const READING_WEIGHT_VALUES: Record<ReadingWeight, string> = {
  light: "300",
  normal: "400",
  medium: "500",
};

export function normalizeReadingWeight(value: unknown): ReadingWeight {
  return READING_WEIGHT_OPTIONS.includes(value as ReadingWeight)
    ? (value as ReadingWeight)
    : DEFAULT_READING_WEIGHT;
}

export function readReadingWeight(): ReadingWeight {
  if (typeof window === "undefined") return DEFAULT_READING_WEIGHT;
  try {
    return normalizeReadingWeight(window.localStorage.getItem(READING_WEIGHT_KEY));
  } catch {
    return DEFAULT_READING_WEIGHT;
  }
}

/**
 * Apply the level: set `--cave-reading-weight` on <html> (or remove it for the
 * default so the inherited 400 applies) and persist the choice.
 */
export function applyReadingWeight(level: ReadingWeight) {
  if (typeof document === "undefined") return;
  const normalized = normalizeReadingWeight(level);
  const root = document.documentElement;
  if (normalized === DEFAULT_READING_WEIGHT) {
    root.style.removeProperty("--cave-reading-weight");
  } else {
    root.style.setProperty("--cave-reading-weight", READING_WEIGHT_VALUES[normalized]);
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(READING_WEIGHT_KEY, normalized);
  } catch {
    /* ignore unavailable storage */
  }
}
