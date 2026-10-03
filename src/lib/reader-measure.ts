/**
 * Direct resize for a DocumentReader's prose measure (#5769).
 *
 * A reader opted in with `resizeKey` renders a drag handle on the edge of its
 * prose column. The width the person settles on is kept per surface in
 * localStorage and wins over the Aa → Width preset until they pick a preset
 * again, reset reading preferences, or double-click the handle.
 *
 * Widths are CSS pixels. The column is still `min(100%, measure)`, so a stored
 * width wider than the pane simply fills the pane.
 */

/** Narrowest useful column: roughly 40 characters of body text. */
export const READER_MEASURE_MIN_PX = 360;

/** `max-w-screen-2xl`: reading content never runs wider than 96rem. */
export const READER_MEASURE_MAX_PX = 1536;

/** Arrow-key step, and the Shift+Arrow step. */
export const READER_MEASURE_STEP_PX = 40;
export const READER_MEASURE_BIG_STEP_PX = 160;

export function readerMeasureStorageKey(surface: string): string {
  return `cave:reader-measure:${surface}`;
}

/**
 * Keep a width inside [min, max], where max is also bounded by the space the
 * column actually has. The lower bound always wins over a tiny `available`.
 */
export function clampReaderMeasure(px: number, available: number = Number.POSITIVE_INFINITY): number {
  const ceiling = Math.max(READER_MEASURE_MIN_PX, Math.min(READER_MEASURE_MAX_PX, available));
  return Math.round(Math.min(Math.max(px, READER_MEASURE_MIN_PX), ceiling));
}

/**
 * The column is centered, so it grows on both sides: moving the right edge by
 * `deltaX` changes the width by twice that, which keeps the edge under the
 * pointer.
 */
export function measureAfterDrag(startWidth: number, deltaX: number, available?: number): number {
  return clampReaderMeasure(startWidth + 2 * deltaX, available);
}

/**
 * Keyboard operation of the separator. Returns the next width, `null` to drop
 * the custom width (back to the preset), or `undefined` when the key is not a
 * resize key and should keep its normal behaviour.
 */
export function measureAfterKey(
  current: number,
  key: string,
  shift: boolean,
  available?: number,
): number | null | undefined {
  const step = shift ? READER_MEASURE_BIG_STEP_PX : READER_MEASURE_STEP_PX;
  switch (key) {
    case "ArrowLeft":
      return clampReaderMeasure(current - step, available);
    case "ArrowRight":
      return clampReaderMeasure(current + step, available);
    case "Home":
      return READER_MEASURE_MIN_PX;
    case "End":
      return clampReaderMeasure(READER_MEASURE_MAX_PX, available);
    case "Enter":
      return null;
    default:
      return undefined;
  }
}

/** A stored value is trusted only if it is a finite number; it is clamped. */
export function parseStoredReaderMeasure(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return clampReaderMeasure(value);
}

export function loadReaderMeasure(surface: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredReaderMeasure(window.localStorage.getItem(readerMeasureStorageKey(surface)));
  } catch {
    return null;
  }
}

export function saveReaderMeasure(surface: string, px: number | null): void {
  if (typeof window === "undefined") return;
  try {
    const key = readerMeasureStorageKey(surface);
    if (px == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(clampReaderMeasure(px)));
  } catch {
    /* storage unavailable: the width still applies for this session */
  }
}
