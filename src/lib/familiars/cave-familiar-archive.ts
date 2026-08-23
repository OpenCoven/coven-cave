"use client";

/**
 * Cave-local familiar archive store.
 *
 * Archived familiars are filtered out of the rail and switchers but stay
 * visible in the Familiar Studio Lifecycle list so users can unarchive.
 * `cave:familiar-archive:v1` maps familiar id → ISO timestamp of archive.
 */

import { useSyncExternalStore } from "react";

const ARCHIVE_KEY = "cave:familiar-archive:v1";

export type ArchiveMap = Record<string, string>;

let cached: ArchiveMap | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

function readFromStorage(): ArchiveMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ArchiveMap;
    }
  } catch { /* corrupt — discard */ }
  return {};
}

function getMap(): ArchiveMap {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function writeMap(next: ArchiveMap) {
  cached = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next));
  }
  notify();
}

export function archiveFamiliar(id: string): void {
  const next = { ...getMap(), [id]: new Date().toISOString() };
  writeMap(next);
}

export function unarchiveFamiliar(id: string): void {
  const curr = getMap();
  if (!(id in curr)) return;
  const next = { ...curr };
  delete next[id];
  writeMap(next);
}

export function isFamiliarArchived(id: string, map: ArchiveMap): boolean {
  return id in map;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === ARCHIVE_KEY) {
      cached = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: ArchiveMap = Object.freeze({});
const getServerSnapshot = () => EMPTY;

export function useArchivedFamiliars(): ArchiveMap {
  return useSyncExternalStore(subscribe, getMap, getServerSnapshot);
}

export function readArchivedFamiliarsSnapshot(): ArchiveMap {
  return getMap();
}
