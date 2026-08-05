/**
 * User-pinned folders for the project-folder picker's sidebar.
 *
 * Explorer's Quick access mixes fixed known folders with folders the user has
 * pinned; the fixed half comes from the server (`GET /api/fs-browse?places=1`)
 * and this is the pinned half. Pins are a per-browser convenience — a shortcut
 * to a folder the user already reached — so they live in localStorage rather
 * than in the project registry, and losing them costs nothing but a click.
 *
 * The parse/toggle half is pure so it can be tested without a DOM; only
 * `readPins`/`writePins` touch storage, and both no-op off the browser.
 */

/** localStorage key holding the picker's pinned folders. */
export const PICKER_PINS_KEY = "cave:picker:pins";

/** Cap so the rail stays a shortcut list instead of becoming a second browser. */
export const MAX_PICKER_PINS = 16;

export type PinnedPlace = { name: string; path: string };

function isPinnedPlace(value: unknown): value is PinnedPlace {
  if (!value || typeof value !== "object") return false;
  const entry = value as { name?: unknown; path?: unknown };
  return (
    typeof entry.name === "string" &&
    typeof entry.path === "string" &&
    entry.name.length > 0 &&
    entry.path.length > 0
  );
}

/**
 * Pins from their stored JSON. Anything malformed — a hand-edited value, a
 * payload from an older shape — degrades to an empty list rather than throwing
 * inside the modal's open path.
 */
export function parsePins(raw: string | null): PinnedPlace[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const pins: PinnedPlace[] = [];
  for (const entry of parsed) {
    if (!isPinnedPlace(entry) || seen.has(entry.path)) continue;
    seen.add(entry.path);
    pins.push({ name: entry.name, path: entry.path });
    if (pins.length === MAX_PICKER_PINS) break;
  }
  return pins;
}

export function serializePins(pins: PinnedPlace[]): string {
  return JSON.stringify(pins);
}

export function isPinned(pins: PinnedPlace[], dir: string): boolean {
  return pins.some((pin) => pin.path === dir);
}

/**
 * Pin `entry` or, when it is already pinned, unpin it. New pins land at the end
 * so the rail keeps a stable order; passing the cap drops the oldest pin.
 */
export function togglePin(pins: PinnedPlace[], entry: PinnedPlace): PinnedPlace[] {
  if (isPinned(pins, entry.path)) return pins.filter((pin) => pin.path !== entry.path);
  const next = [...pins, { name: entry.name, path: entry.path }];
  return next.length > MAX_PICKER_PINS ? next.slice(next.length - MAX_PICKER_PINS) : next;
}

export function readPins(): PinnedPlace[] {
  if (typeof window === "undefined") return [];
  try {
    return parsePins(window.localStorage.getItem(PICKER_PINS_KEY));
  } catch {
    // Private-mode / disabled storage — the picker works, it just can't pin.
    return [];
  }
}

export function writePins(pins: PinnedPlace[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PICKER_PINS_KEY, serializePins(pins));
  } catch {
    /* storage full or blocked — the in-memory list still drives this session */
  }
}
