"use client";

/**
 * Cave-local familiar order store.
 *
 * Lives in localStorage under `cave:familiar-order:v1` as a flat array of
 * familiar ids in the user's preferred display order. Familiars the user has
 * never reordered (e.g., a fresh familiar from the daemon) fall through to
 * daemon order at the tail.
 *
 * UI-side only — same shape as cave-glyph-overrides. The daemon stays the
 * canonical source for *which* familiars exist; this store just decides how
 * to render them.
 */

import { useSyncExternalStore } from "react";

const ORDER_KEY = "cave:familiar-order:v1";

let cachedOrder: string[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function readFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    /* corrupt — discard */
  }
  return [];
}

function getOrder(): string[] {
  if (cachedOrder === null) cachedOrder = readFromStorage();
  return cachedOrder;
}

function writeOrder(next: string[]) {
  cachedOrder = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(next));
  }
  notify();
}

/** Replace the saved order. Pass the full id list in the new sequence. */
export function setFamiliarOrder(ids: string[]): void {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id)) continue;
    deduped.push(id);
    seen.add(id);
  }
  writeOrder(deduped);
}

/** Forget the user's order; familiars revert to daemon order. */
export function clearFamiliarOrder(): void {
  if (getOrder().length === 0) return;
  writeOrder([]);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === ORDER_KEY) {
      cachedOrder = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: readonly string[] = Object.freeze([]);
const getServerSnapshot = () => EMPTY as string[];

/** React hook: saved order. Re-renders on any mutation. */
export function useFamiliarOrder(): string[] {
  return useSyncExternalStore(subscribe, getOrder, getServerSnapshot);
}

/**
 * Re-sort a daemon-provided familiar list per the saved order. Unknown ids
 * (e.g., newly created familiars) are appended in their daemon order, so the
 * user never loses a familiar just because they haven't reordered yet.
 */
export function applyFamiliarOrder<T extends { id: string }>(
  familiars: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...familiars];
  const byId = new Map<string, T>();
  for (const f of familiars) byId.set(f.id, f);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of order) {
    const f = byId.get(id);
    if (f && !seen.has(id)) {
      out.push(f);
      seen.add(id);
    }
  }
  for (const f of familiars) {
    if (!seen.has(f.id)) out.push(f);
  }
  return out;
}
