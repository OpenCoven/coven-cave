/**
 * role-surface-state — per-familiar, per-surface UI state for Role Surfaces.
 *
 * Local room state (selected collection, open drawer, filters, drafts, notes,
 * focused item…) is keyed `surfaceState[familiarId][surfaceId]` so it survives
 * switching between surfaces AND between familiars. Backed by localStorage
 * under the `cave:` namespace (matching familiar-memory.ts) with an in-memory
 * mirror so reads stay cheap and non-browser environments (tests, SSR) work.
 *
 * Pure store + a small `useRoleSurfaceState` hook (no JSX — node-testable).
 */

import { useCallback, useSyncExternalStore } from "react";

const stateKey = (familiarId: string, surfaceId: string): string =>
  `cave:role-surface:${familiarId}:${surfaceId}`;

// In-memory mirror. The map is the source of truth for the session;
// localStorage persists it across reloads.
const cache = new Map<string, unknown>();
const loaded = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* quota / strict privacy — keep the in-memory copy */ }
}

function load(key: string): unknown {
  if (!loaded.has(key)) {
    loaded.add(key);
    const raw = safeGet(key);
    if (raw != null) {
      try { cache.set(key, JSON.parse(raw)); } catch { /* corrupt — start fresh */ }
    }
  }
  return cache.get(key);
}

function emit(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

/** Read a surface's persisted state (null when none). */
export function readRoleSurfaceState<T>(familiarId: string, surfaceId: string): T | null {
  const value = load(stateKey(familiarId, surfaceId));
  return value === undefined ? null : (value as T);
}

/** Write (or clear, with null) a surface's persisted state. */
export function writeRoleSurfaceState(familiarId: string, surfaceId: string, state: unknown): void {
  const key = stateKey(familiarId, surfaceId);
  loaded.add(key);
  if (state == null) {
    cache.delete(key);
    safeSet(key, null);
  } else {
    cache.set(key, state);
    safeSet(key, JSON.stringify(state));
  }
  emit(key);
}

/** Test-only: drop the in-memory mirror so persistence paths re-run. */
export function clearRoleSurfaceStateForTest(): void {
  cache.clear();
  loaded.clear();
}

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * React binding: `[state, patch]` for one familiar+surface pair. `initial` is
 * returned until something is written; `patch` shallow-merges into the stored
 * object so independent pieces of room state don't clobber each other.
 */
export function useRoleSurfaceState<T extends object>(
  familiarId: string,
  surfaceId: string,
  initial: T,
): [T, (patch: Partial<T>) => void] {
  const key = stateKey(familiarId, surfaceId);
  const stored = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    () => load(key) as T | undefined,
    () => undefined,
  );
  const patch = useCallback(
    (partial: Partial<T>) => {
      const current = (readRoleSurfaceState<T>(familiarId, surfaceId) ?? initial) as T;
      writeRoleSurfaceState(familiarId, surfaceId, { ...current, ...partial });
    },
    // `initial` is a mount-time default, deliberately not a dependency.
    [familiarId, surfaceId, initial],
  );
  return [stored === undefined ? initial : { ...initial, ...stored }, patch];
}
