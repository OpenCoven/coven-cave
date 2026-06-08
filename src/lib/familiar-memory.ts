// Per-familiar shell state persistence. All keys live under the `cave:` prefix
// so a future sweep can clean orphans by namespace.
//
// All readers SSR-guard (Next.js renders this code on both server and client).

const ACTIVE_KEY = "cave:active-familiar";

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
