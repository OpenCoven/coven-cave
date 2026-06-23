// Cave-local "quick switch" state for the familiar avatar strip in the top bar.
//
// Two pieces of UI-only state, both under the `cave:` namespace:
//   • pins      — `cave:familiar-pins:v1`      → ordered string[] of familiar ids
//                 the user wants to keep in the strip regardless of recency.
//   • last-used — `cave:familiar-last-used:v1`  → Record<id, epochMs> stamped each
//                 time the user switches into a familiar.
//
// The strip shows pinned familiars first (in pin order), then fills the
// remaining slots with the most-recently-used familiars (see `computeQuickSwitch`).
//
// No "use client" / React here — this module is import-safe from Node tests and
// SSR. The React hooks that subscribe to it live in `use-familiar-quick-switch`.
// The daemon stays the source of *which* familiars exist; this only decides how
// to surface them.

const PINS_KEY = "cave:familiar-pins:v1";
const LAST_USED_KEY = "cave:familiar-last-used:v1";

/** Default number of avatars shown in the quick-switch strip. */
export const QUICK_SWITCH_MAX = 6;

// ── storage primitives (SSR-guarded, never throw) ───────────────────────────

function rawGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function rawSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, value); } catch { /* quota / strict-privacy */ }
}

// ── change notification (shared with the React hooks) ───────────────────────

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Subscribe to pin/last-used changes. Returns an unsubscribe fn. */
export function subscribeQuickSwitch(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── pins ────────────────────────────────────────────────────────────────────

let cachedPins: string[] | null = null;

function readPins(): string[] {
  const raw = rawGet(PINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch { /* corrupt — discard */ }
  return [];
}

/** Current pin order (cached; stable reference until a mutation). */
export function getPins(): string[] {
  if (cachedPins === null) cachedPins = readPins();
  return cachedPins;
}

function writePins(next: string[]) {
  const seen = new Set<string>();
  const deduped = next.filter((id) => typeof id === "string" && !seen.has(id) && (seen.add(id), true));
  cachedPins = deduped;
  rawSet(PINS_KEY, JSON.stringify(deduped));
  notify();
}

export function isPinned(id: string): boolean {
  return getPins().includes(id);
}

/** Pin or unpin a familiar from the quick-switch strip. Newly pinned ids go to
 *  the end so existing pin order is preserved. */
export function togglePin(id: string): void {
  const current = getPins();
  writePins(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}

/** Replace the full pin list in a new order (e.g. drag-to-reorder in Settings).
 *  Deduped on write; the sequence given becomes the strip's pin order. */
export function setPins(ids: string[]): void {
  writePins(ids);
}

// ── last-used recency ────────────────────────────────────────────────────────

let cachedLastUsed: Record<string, number> | null = null;

function readLastUsed(): Record<string, number> {
  const raw = rawGet(LAST_USED_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
  } catch { /* corrupt — discard */ }
  return {};
}

/** Last-used timestamps (cached; stable reference until a mutation). */
export function getLastUsed(): Record<string, number> {
  if (cachedLastUsed === null) cachedLastUsed = readLastUsed();
  return cachedLastUsed;
}

/** Stamp a familiar as just-used. Call this on every switch into a familiar so
 *  the strip reflects real recency. */
export function recordFamiliarUsed(id: string): void {
  if (!id) return;
  const next = { ...getLastUsed(), [id]: Date.now() };
  cachedLastUsed = next;
  rawSet(LAST_USED_KEY, JSON.stringify(next));
  notify();
}

// Cross-tab sync: another tab's write invalidates our cache.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === PINS_KEY) { cachedPins = null; notify(); }
    else if (e.key === LAST_USED_KEY) { cachedLastUsed = null; notify(); }
  });
}

// ── pure ordering ─────────────────────────────────────────────────────────────

/** Parse a daemon `last_seen` ISO string to epoch ms, or 0 if absent/invalid. */
function lastSeenMs(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

type QuickSwitchOpts = {
  pins?: readonly string[];
  lastUsed?: Readonly<Record<string, number>>;
  /** The active familiar is always surfaced (treated as most-recent). */
  activeId?: string | null;
  max?: number;
  /**
   * Which familiars the strip surfaces:
   *   • "all"    — pinned, then active, then recency-ranked (the default).
   *   • "pinned" — ONLY the pinned familiars, in pin order. The active/recent
   *                fill steps are skipped so the strip is a curated set.
   */
  scope?: "all" | "pinned";
};

/**
 * Decide which familiars fill the quick-switch strip, in display order:
 *   1. pinned familiars, in pin order (only those still present);
 *   2. the active familiar (if not already pinned);
 *   3. remaining familiars by most-recent use (cave last-used, then daemon
 *      `last_seen`), preserving the input order as a stable tiebreak.
 * Capped at `max` (default {@link QUICK_SWITCH_MAX}).
 *
 * When `scope` is "pinned", only step 1 runs — the strip is exactly the pinned
 * familiars (still present), in pin order.
 */
export function computeQuickSwitch<T extends { id: string; last_seen?: string }>(
  familiars: readonly T[],
  opts: QuickSwitchOpts = {},
): T[] {
  const max = opts.max ?? QUICK_SWITCH_MAX;
  if (max <= 0) return [];
  const pins = opts.pins ?? [];
  const lastUsed = opts.lastUsed ?? {};
  const activeId = opts.activeId ?? null;
  const scope = opts.scope ?? "all";

  const byId = new Map<string, T>();
  familiars.forEach((f) => byId.set(f.id, f));

  const seen = new Set<string>();
  const out: T[] = [];
  const take = (f: T | undefined) => {
    if (!f || seen.has(f.id) || out.length >= max) return;
    seen.add(f.id);
    out.push(f);
  };

  // 1. pins (in order)
  for (const id of pins) take(byId.get(id));
  // "pinned" scope stops here — the strip is exactly the pinned familiars.
  if (scope === "pinned") return out;
  // 2. active familiar
  if (activeId) take(byId.get(activeId));
  // 3. recency-ranked remainder
  const rest = familiars
    .map((f, index) => ({ f, index, score: lastUsed[f.id] ?? lastSeenMs(f.last_seen) }))
    .filter(({ f }) => !seen.has(f.id))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  for (const { f } of rest) take(f);

  return out;
}
