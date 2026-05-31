"use client";

/**
 * Cave-local glyph override store + recent-glyph history.
 *
 * Lives in localStorage under `cave:glyph-overrides:v1` for per-familiar
 * picks and `cave:glyph-recent:v1` for the recents row in the picker.
 *
 * This is deliberately a UI-side store, not a daemon write — the user's
 * choices apply to *their* Cave install, not the underlying
 * `~/.coven/familiars.toml`. When the daemon grows an `icon` field on
 * familiars (follow-up PR), the store can opt into syncing.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

const OVERRIDES_KEY = "cave:glyph-overrides:v1";
const RECENT_KEY = "cave:glyph-recent:v1";
const RECENT_MAX = 16;

type OverrideMap = Record<string, string>;

// ---------------------------------------------------------------------------
// In-memory mirror + change broadcaster
// ---------------------------------------------------------------------------

let cachedOverrides: OverrideMap | null = null;
let cachedRecent: string[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function readOverridesFromStorage(): OverrideMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as OverrideMap;
    }
  } catch {
    /* corrupt — discard */
  }
  return {};
}

function readRecentFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    /* corrupt — discard */
  }
  return [];
}

function getOverrides(): OverrideMap {
  if (cachedOverrides === null) cachedOverrides = readOverridesFromStorage();
  return cachedOverrides;
}

function getRecent(): string[] {
  if (cachedRecent === null) cachedRecent = readRecentFromStorage();
  return cachedRecent;
}

function writeOverrides(next: OverrideMap) {
  cachedOverrides = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
  }
  notify();
}

function writeRecent(next: string[]) {
  cachedRecent = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }
  notify();
}

// ---------------------------------------------------------------------------
// Mutators (always go through these so listeners fire)
// ---------------------------------------------------------------------------

/** Set the glyph override for a single familiar. */
export function setGlyphOverride(familiarId: string, glyph: string): void {
  const next = { ...getOverrides(), [familiarId]: glyph };
  writeOverrides(next);
  pushRecent(glyph);
}

/** Remove the override so we fall back to daemon emoji / default. */
export function clearGlyphOverride(familiarId: string): void {
  const curr = getOverrides();
  if (!(familiarId in curr)) return;
  const next = { ...curr };
  delete next[familiarId];
  writeOverrides(next);
}

/** Move `glyph` to the head of the recents list, deduped, capped at RECENT_MAX. */
export function pushRecent(glyph: string): void {
  const curr = getRecent();
  const next = [glyph, ...curr.filter((g) => g !== glyph)].slice(0, RECENT_MAX);
  if (next.length === curr.length && next.every((g, i) => g === curr[i])) return;
  writeRecent(next);
}

// ---------------------------------------------------------------------------
// Cross-tab + cross-component sync
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === OVERRIDES_KEY) {
      cachedOverrides = null;
      notify();
    } else if (e.key === RECENT_KEY) {
      cachedRecent = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: glyph override map. Re-renders on any mutation. */
export function useGlyphOverrides(): OverrideMap {
  return useSyncExternalStore(subscribe, getOverrides, getOverrides);
}

/** React hook: recents list. Re-renders on any mutation. */
export function useRecentGlyphs(): string[] {
  // useSyncExternalStore needs server snapshot too; recents are empty on SSR.
  const sub = (fn: () => void) => subscribe(fn);
  const get = () => getRecent();
  const getServer = () => [] as string[];
  // useSyncExternalStore is imported above; calling it directly here keeps the
  // hook self-contained without exposing the subscribe/snapshot signatures.
  return useSyncExternalStore(sub, get, getServer);
}

/**
 * Tiny non-hook accessor for places (e.g. one-shot reads) that can't take a
 * hook. Always returns the latest snapshot; will not re-render anything.
 */
export function readGlyphOverridesSnapshot(): OverrideMap {
  return getOverrides();
}

/** Pre-warm the cache during initial app mount so SSR/CSR agree. */
export function useHydrateGlyphStore(): void {
  // The first read on the client primes both caches; this just guarantees the
  // hydration boundary happens once and re-renders downstream consumers.
  const [, force] = useState(0);
  useEffect(() => {
    if (cachedOverrides === null || cachedRecent === null) {
      cachedOverrides = readOverridesFromStorage();
      cachedRecent = readRecentFromStorage();
      force((n) => n + 1);
    }
  }, []);
}
