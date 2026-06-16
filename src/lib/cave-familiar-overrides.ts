"use client";

/**
 * Cave-local familiar metadata override store.
 *
 * Layered on top of daemon-owned `Familiar` fields. Each entry is a *partial*
 * override — only fields the user has explicitly set live here. Resolution
 * (see `familiar-resolve.ts`) falls through to the daemon value when a field
 * is absent.
 *
 * Lives in localStorage under `cave:familiar-overrides:v1`. Cross-tab sync
 * + cross-component re-render follows the same `useSyncExternalStore` +
 * `storage`-event pattern as `cave-glyph-overrides.ts`.
 */

import { useSyncExternalStore } from "react";

const OVERRIDES_KEY = "cave:familiar-overrides:v1";

export type FamiliarOverride = {
  display_name?: string;
  role?: string;
  pronouns?: string;
  description?: string;
  /** CSS color string (hex, oklch, named). Drives the rail accent ring. */
  color?: string;
};

type OverrideMap = Record<string, FamiliarOverride>;
type ConfigPatch = Partial<Record<keyof FamiliarOverride, string | null>>;

let cached: OverrideMap | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function readFromStorage(): OverrideMap {
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

function getMap(): OverrideMap {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function writeMap(next: OverrideMap) {
  cached = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
  }
  notify();
}

async function syncToConfig(id: string, patch: ConfigPatch | null): Promise<void> {
  if (typeof window === "undefined") return;
  const { reportDaemonSyncFailure, reportDaemonSyncSuccess } = await import(
    "./daemon-sync-status.ts"
  );
  try {
    const res = await fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiars: { [id]: patch } }),
    });
    if (res.ok) reportDaemonSyncSuccess();
    else reportDaemonSyncFailure(`cave-config write: HTTP ${res.status}`);
  } catch (err) {
    reportDaemonSyncFailure(`cave-config write: ${(err as Error).message}`);
  }
}

function configPatchForOverridePatch(patch: Partial<FamiliarOverride>): ConfigPatch {
  const configPatch: ConfigPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim() === "") {
      configPatch[key as keyof FamiliarOverride] = null;
    } else if (value !== undefined) {
      configPatch[key as keyof FamiliarOverride] = value;
    }
  }
  return configPatch;
}

/** Merge a partial override patch for one familiar. Empty-string values are dropped. */
export function setFamiliarOverride(
  id: string,
  patch: Partial<FamiliarOverride>,
): void {
  const curr = getMap();
  const existing = curr[id] ?? {};
  const next: FamiliarOverride = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim() === "") {
      // Empty string ⇒ treat as a clear of that field.
      delete next[key as keyof FamiliarOverride];
    } else if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  const isEmpty = Object.keys(next).length === 0;
  const updated = { ...curr };
  if (isEmpty) delete updated[id];
  else updated[id] = next;
  writeMap(updated);
  const configPatch = configPatchForOverridePatch(patch);
  if (Object.keys(configPatch).length > 0) void syncToConfig(id, configPatch);
}

/** Clear a single override field; drops the id entry entirely if it becomes empty. */
export function clearFamiliarOverrideField(
  id: string,
  field: keyof FamiliarOverride,
): void {
  const curr = getMap();
  if (!curr[id] || !(field in curr[id])) return;
  const nextEntry = { ...curr[id] };
  delete nextEntry[field];
  const updated = { ...curr };
  if (Object.keys(nextEntry).length === 0) delete updated[id];
  else updated[id] = nextEntry;
  writeMap(updated);
  void syncToConfig(id, { [field]: null });
}

/** Drop every override field for a familiar. */
export function clearAllFamiliarOverrides(id: string): void {
  const curr = getMap();
  if (!(id in curr)) return;
  const updated = { ...curr };
  delete updated[id];
  writeMap(updated);
  void syncToConfig(id, null);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === OVERRIDES_KEY) {
      cached = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: OverrideMap = Object.freeze({});
const getServerSnapshot = () => EMPTY;

export function useFamiliarOverrides(): OverrideMap {
  return useSyncExternalStore(subscribe, getMap, getServerSnapshot);
}

export function readFamiliarOverridesSnapshot(): OverrideMap {
  return getMap();
}
