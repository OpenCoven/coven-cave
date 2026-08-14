/**
 * Where the code reading inspector opens — split beside the transcript, as an
 * overlay, or `auto` (cave-f6mu9).
 *
 * Scoped per familiar. Reading beside a coding familiar's long diffs and
 * reading beside a research familiar's short quotes want different layouts,
 * and a single global pin would make one of them wrong every time. An unscoped
 * read falls back to the shared default so surfaces without a familiar in hand
 * (previews, tests) still get a sane value.
 *
 * Mirrors src/lib/reading-leading.ts: a small enum in localStorage, normalized
 * on every read so a hand-edited or stale value can never widen the type.
 */

import { isInspectorPin, type InspectorPin } from "./code-reading.ts";

export const CODE_READING_PIN_KEY = "cave:code-reading-pin";

export const DEFAULT_CODE_READING_PIN: InspectorPin = "auto";

export function normalizeCodeReadingPin(value: unknown): InspectorPin {
  return isInspectorPin(typeof value === "string" ? value : null)
    ? (value as InspectorPin)
    : DEFAULT_CODE_READING_PIN;
}

/** `cave:code-reading-pin` for the shared default, `…:<familiarId>` per familiar. */
export function codeReadingPinKey(familiarId?: string | null): string {
  return familiarId ? `${CODE_READING_PIN_KEY}:${familiarId}` : CODE_READING_PIN_KEY;
}

export function readCodeReadingPin(familiarId?: string | null): InspectorPin {
  if (typeof window === "undefined") return DEFAULT_CODE_READING_PIN;
  try {
    const scoped = window.localStorage.getItem(codeReadingPinKey(familiarId));
    if (isInspectorPin(scoped)) return scoped;
    // No preference for THIS familiar yet: inherit the shared default rather
    // than snapping to `auto`, so a reader who set a house style once does not
    // have to set it again for every familiar they talk to.
    return normalizeCodeReadingPin(window.localStorage.getItem(CODE_READING_PIN_KEY));
  } catch {
    return DEFAULT_CODE_READING_PIN;
  }
}

export function writeCodeReadingPin(pin: InspectorPin, familiarId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(codeReadingPinKey(familiarId), pin);
    // The most recent explicit choice also becomes the shared default, which is
    // what makes the inheritance above feel like a house style rather than a
    // value frozen at whatever the first familiar happened to use.
    window.localStorage.setItem(CODE_READING_PIN_KEY, pin);
  } catch {
    // Private mode / quota. The pin stays in component state for this session.
  }
}
