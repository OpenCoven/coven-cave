// Reader text size — the A−/A+ steps and their persistence.
//
// Kept out of the component so the stepping and clamping are testable without
// a DOM, and so a corrupt or hand-edited stored value has exactly one place
// that decides what to do with it.

export const READER_TEXT_SCALE_STORAGE_KEY = "cave:reader:text-scale";

// Five steps, with the shipped size at index 2 so the control has equal travel
// in both directions. Multipliers rather than absolute sizes: the reader's type
// is a scale (display/lg/md/base/sm), and multiplying preserves the intervals
// between those tokens instead of flattening them toward one size.
export const READER_TEXT_SCALE_STEPS = [0.875, 1, 1.125, 1.25, 1.4] as const;

export const READER_TEXT_SCALE_DEFAULT_INDEX = 1;

export function clampScaleIndex(index: number): number {
  if (!Number.isFinite(index)) return READER_TEXT_SCALE_DEFAULT_INDEX;
  return Math.min(READER_TEXT_SCALE_STEPS.length - 1, Math.max(0, Math.trunc(index)));
}

export function scaleForIndex(index: number): number {
  return READER_TEXT_SCALE_STEPS[clampScaleIndex(index)];
}

/** Percentage label for the control's title/announcement, e.g. 112%. */
export function scaleLabel(index: number): string {
  return `${Math.round(scaleForIndex(index) * 100)}%`;
}

/**
 * Parse a stored value into a step index.
 *
 * Anything unparseable falls back to the default rather than throwing: this
 * reads from localStorage, which the user can edit, another tab can write, and
 * a future version can change the shape of. A reader that refuses to render
 * because a preference is malformed would be a worse bug than a reset size.
 */
export function parseStoredScaleIndex(raw: string | null | undefined): number {
  if (raw == null) return READER_TEXT_SCALE_DEFAULT_INDEX;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return READER_TEXT_SCALE_DEFAULT_INDEX;
  return clampScaleIndex(parsed);
}

/**
 * Read the persisted index. Returns the default when storage is unavailable —
 * Safari private mode throws on access, and the desktop shell runs the app in a
 * WKWebView where storage can be partitioned.
 */
export function loadScaleIndex(storage?: Pick<Storage, "getItem"> | null): number {
  const store = storage ?? safeLocalStorage();
  if (!store) return READER_TEXT_SCALE_DEFAULT_INDEX;
  try {
    return parseStoredScaleIndex(store.getItem(READER_TEXT_SCALE_STORAGE_KEY));
  } catch {
    return READER_TEXT_SCALE_DEFAULT_INDEX;
  }
}

/** Persist the index. Silently a no-op when storage is unavailable or full. */
export function saveScaleIndex(
  index: number,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  const store = storage ?? safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(READER_TEXT_SCALE_STORAGE_KEY, String(clampScaleIndex(index)));
  } catch {
    // Quota or a partitioned store — the size still applies for this session.
  }
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
