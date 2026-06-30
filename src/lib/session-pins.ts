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

export function subscribeSessionPins(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getPinnedSessionIds(): string[] {
  const raw = rawGet(PINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function isSessionPinned(id: string): boolean {
  return getPinnedSessionIds().includes(id);
}

export function setPinnedSessionIds(ids: string[]): void {
  const unique = Array.from(new Set(ids.filter((x) => typeof x === "string" && x.length > 0)));
  rawSet(PINS_KEY, JSON.stringify(unique));
  notify();
}

export function toggleSessionPin(id: string): void {
  const current = getPinnedSessionIds();
  setPinnedSessionIds(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === PINS_KEY) notify();
  });
}
