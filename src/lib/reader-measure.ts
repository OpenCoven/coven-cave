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

/** `max-w-screen-2xl`: reading content never runs wider than 96rem. CSS
 *  enforces the cap in rem (so it scales with the app's root font size);
 *  the JS bound below is the same 96rem resolved against a root size. */
export const READER_MEASURE_MAX_REM = 96;
/** 96rem at the default 16px root. */
export const READER_MEASURE_MAX_PX = READER_MEASURE_MAX_REM * 16;

/** The cap in CSS pixels for a given root font size. */
export function readerMeasureMaxPx(rootFontPx: number = 16): number {
  const root = Number.isFinite(rootFontPx) && rootFontPx > 0 ? rootFontPx : 16;
  return Math.round(READER_MEASURE_MAX_REM * root);
}

/** The inline value: a stored pixel width, still never past 96rem. */
export function readerMeasureCss(px: number): string {
  return `min(${Math.round(px)}px, ${READER_MEASURE_MAX_REM}rem)`;
}

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
export function clampReaderMeasure(
  px: number,
  available: number = Number.POSITIVE_INFINITY,
  max: number = READER_MEASURE_MAX_PX,
): number {
  const ceiling = Math.max(READER_MEASURE_MIN_PX, Math.min(max, available));
  return Math.round(Math.min(Math.max(px, READER_MEASURE_MIN_PX), ceiling));
}

/**
 * The column is centered, so it grows on both sides: moving the right edge by
 * `deltaX` changes the width by twice that, which keeps the edge under the
 * pointer.
 */
export function measureAfterDrag(
  startWidth: number,
  deltaX: number,
  available?: number,
  max?: number,
): number {
  return clampReaderMeasure(startWidth + 2 * deltaX, available, max);
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
  max: number = READER_MEASURE_MAX_PX,
): number | null | undefined {
  const step = shift ? READER_MEASURE_BIG_STEP_PX : READER_MEASURE_STEP_PX;
  switch (key) {
    case "ArrowLeft":
      return clampReaderMeasure(current - step, available, max);
    case "ArrowRight":
      return clampReaderMeasure(current + step, available, max);
    case "Home":
      return READER_MEASURE_MIN_PX;
    case "End":
      return clampReaderMeasure(max, available, max);
    case "Enter":
      return null;
    default:
      return undefined;
  }
}

/** Generous sanity bound for stored widths; rendering still caps at 96rem. */
const STORED_MEASURE_SANITY_MAX_PX = 4096;

/** A stored value is trusted only if it is a finite number; it is clamped. */
export function parseStoredReaderMeasure(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return clampReaderMeasure(value, Number.POSITIVE_INFINITY, STORED_MEASURE_SANITY_MAX_PX);
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
    else window.localStorage.setItem(key, String(clampReaderMeasure(px, Number.POSITIVE_INFINITY, STORED_MEASURE_SANITY_MAX_PX)));
  } catch {
    /* storage unavailable: the width still applies for this session */
  }
}
