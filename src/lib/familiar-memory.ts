// Per-familiar shell state persistence. All keys live under the `cave:` prefix
// so a future sweep can clean orphans by namespace.
//
// All readers SSR-guard (Next.js renders this code on both server and client).

const ACTIVE_KEY = "cave:active-familiar";
// The full multiselect scope (JSON string[]). Empty/absent = "All familiars".
// ACTIVE_KEY is kept in sync as the single "primary" (the lone id when exactly
// one is scoped, else null) so other readers — e.g. the iOS app — still work.
const SCOPE_KEY = "cave:familiar-scope";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* quota / strict-privacy — give up silently */ }
}

export function getActiveFamiliar(): string | null {
  return safeGet(ACTIVE_KEY);
}

export function setActiveFamiliar(id: string | null): void {
  safeSet(ACTIVE_KEY, id);
}

/**
 * The persisted multiselect scope. Falls back to the legacy single
 * `cave:active-familiar` (so existing users keep their scoped familiar) when no
 * scope set has been written yet.
 */
export function getFamiliarScope(): string[] {
  const raw = safeGet(SCOPE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch { /* corrupt — fall through to the legacy single key */ }
  }
  const single = getActiveFamiliar();
  return single ? [single] : [];
}

/** Persist the scope set and keep the legacy single key in sync (lone id or null). */
export function setFamiliarScope(ids: readonly string[]): void {
  const deduped = [...new Set(ids.filter((x) => typeof x === "string"))];
  safeSet(SCOPE_KEY, JSON.stringify(deduped));
  setActiveFamiliar(deduped.length === 1 ? deduped[0]! : null);
}

export function getLastSurface(familiarId: string): string | null {
  return safeGet(`cave:familiar:${familiarId}:last-surface`);
}

export function setLastSurface(familiarId: string, surface: string): void {
  safeSet(`cave:familiar:${familiarId}:last-surface`, surface);
}

export function getRailOpen(familiarId: string): boolean {
  const raw = safeGet(`cave:familiar:${familiarId}:rail.open`);
  return raw === "1"; // default closed
}

export function setRailOpen(familiarId: string, open: boolean): void {
  safeSet(`cave:familiar:${familiarId}:rail.open`, open ? "1" : "0");
}
