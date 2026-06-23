"use client";

/**
 * User preference for WHICH familiars the top-bar avatar strip surfaces (only
 * relevant when the switcher style is "avatars"):
 *
 *   • "pinned" — only the user's pinned familiars (in pin order). The default;
 *                keeps the strip a deliberate, curated set.
 *   • "all"    — every familiar (pin/recency-ordered), scrolling on overflow.
 *
 * Cave-local, persisted in localStorage under `cave:familiar-strip-scope`.
 * Reactive via useSyncExternalStore so the top bars re-render the moment the
 * Settings control flips it. Mirrors {@link familiar-switcher-style}.
 */

import { useSyncExternalStore } from "react";

export const FAMILIAR_STRIP_SCOPE_KEY = "cave:familiar-strip-scope";

export const FAMILIAR_STRIP_SCOPE_OPTIONS = ["pinned", "all"] as const;

export type FamiliarStripScope = (typeof FAMILIAR_STRIP_SCOPE_OPTIONS)[number];

export const DEFAULT_FAMILIAR_STRIP_SCOPE = "pinned" as const;

export const FAMILIAR_STRIP_SCOPE_LABELS: Record<FamiliarStripScope, string> = {
  pinned: "Pinned only",
  all: "All familiars",
};

export function normalizeFamiliarStripScope(value: unknown): FamiliarStripScope {
  return FAMILIAR_STRIP_SCOPE_OPTIONS.includes(value as FamiliarStripScope)
    ? (value as FamiliarStripScope)
    : DEFAULT_FAMILIAR_STRIP_SCOPE;
}

let cached: FamiliarStripScope | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function read(): FamiliarStripScope {
  if (typeof window === "undefined") return DEFAULT_FAMILIAR_STRIP_SCOPE;
  try {
    return normalizeFamiliarStripScope(window.localStorage.getItem(FAMILIAR_STRIP_SCOPE_KEY));
  } catch {
    return DEFAULT_FAMILIAR_STRIP_SCOPE;
  }
}

function getSnapshot(): FamiliarStripScope {
  if (cached === null) cached = read();
  return cached;
}

/** Persist the preference and notify subscribers. */
export function setFamiliarStripScope(scope: FamiliarStripScope): void {
  const normalized = normalizeFamiliarStripScope(scope);
  cached = normalized;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(FAMILIAR_STRIP_SCOPE_KEY, normalized); } catch { /* ignore */ }
  }
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === FAMILIAR_STRIP_SCOPE_KEY) {
      cached = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getServerSnapshot = () => DEFAULT_FAMILIAR_STRIP_SCOPE;

/** React hook: which familiars the avatar strip surfaces. Re-renders on change. */
export function useFamiliarStripScope(): FamiliarStripScope {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
