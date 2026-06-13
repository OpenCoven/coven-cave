/**
 * Reading drop cap — an enlarged decorative first letter for long-form reading.
 *
 * Scoped to the LIBRARY DOC READER only (`.library-preview-md.cave-md`), not
 * the shared chat/memory `.cave-md` surface — a drop cap on every chat message
 * would be absurd. Because a `::first-letter` drop cap is several coordinated
 * properties, it's gated by a `data-reading-dropcap="on"` attribute on <html>
 * rather than a CSS var (mirrors the theme / screen-scale data-attribute apply).
 *
 * Off (default) removes the attribute, so the gated CSS rule never matches.
 */
export const READING_DROPCAP_KEY = "cave:reading-dropcap";
export const READING_DROPCAP_ATTR = "data-reading-dropcap";

export const READING_DROPCAP_OPTIONS = ["off", "on"] as const;

export type ReadingDropcap = (typeof READING_DROPCAP_OPTIONS)[number];

export const DEFAULT_READING_DROPCAP: ReadingDropcap = "off";

export function normalizeReadingDropcap(value: unknown): ReadingDropcap {
  return READING_DROPCAP_OPTIONS.includes(value as ReadingDropcap)
    ? (value as ReadingDropcap)
    : DEFAULT_READING_DROPCAP;
}

export function readReadingDropcap(): ReadingDropcap {
  if (typeof window === "undefined") return DEFAULT_READING_DROPCAP;
  try {
    return normalizeReadingDropcap(window.localStorage.getItem(READING_DROPCAP_KEY));
  } catch {
    return DEFAULT_READING_DROPCAP;
  }
}

/**
 * Apply the level: set `data-reading-dropcap="on"` on <html> (or remove it for
 * the default) so the gated `::first-letter` rule matches, and persist it.
 */
export function applyReadingDropcap(level: ReadingDropcap) {
  if (typeof document === "undefined") return;
  const normalized = normalizeReadingDropcap(level);
  const root = document.documentElement;
  if (normalized === DEFAULT_READING_DROPCAP) {
    root.removeAttribute(READING_DROPCAP_ATTR);
  } else {
    root.setAttribute(READING_DROPCAP_ATTR, "on");
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(READING_DROPCAP_KEY, normalized);
  } catch {
    /* ignore unavailable storage */
  }
}
