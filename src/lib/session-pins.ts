// Cave-local pinned-session state for the Code sidebar's "Pinned" section.
// UI-only, under the `cave:` namespace, no "use client" — Node/SSR safe.
// Mirrors the proven `familiar-quick-switch` store pattern.

const PINS_KEY = "cave:session-pins:v1";

function rawGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function rawSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, value); } catch { /* quota */ }
}

const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) fn(); }

// Snapshot cache. `useSyncExternalStore` requires getSnapshot to return a
// STABLE reference when the underlying data is unchanged — otherwise React
// throws "The result of getSnapshot should be cached to avoid an infinite
// loop". We parse localStorage once and reuse the array until a mutation (or a
// cross-tab `storage` event) invalidates it. Mirrors `familiar-quick-switch`.
let cachedPins: string[] | null = null;

function readPins(): string[] {
  const raw = rawGet(PINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function subscribeSessionPins(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Current pinned-session ids (cached; stable reference until a mutation). */
export function getPinnedSessionIds(): string[] {
  if (cachedPins === null) cachedPins = readPins();
  return cachedPins;
}

export function isSessionPinned(id: string): boolean {
  return getPinnedSessionIds().includes(id);
}

export function setPinnedSessionIds(ids: string[]): void {
  const unique = Array.from(new Set(ids.filter((x) => typeof x === "string" && x.length > 0)));
  cachedPins = unique;
  rawSet(PINS_KEY, JSON.stringify(unique));
  notify();
}

export function toggleSessionPin(id: string): void {
  const current = getPinnedSessionIds();
  setPinnedSessionIds(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === PINS_KEY) {
      cachedPins = null; // another tab mutated pins — drop the cache before notifying
      notify();
    }
  });
}
