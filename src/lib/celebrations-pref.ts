"use client";

/**
 * Progression celebrations preference — the "dial it down" switch for the
 * renown system's louder moments (milestone toasts, completion flourishes).
 *
 * Default ON. Off is a clean-tool mode, not a mute-with-loss: milestones
 * still land in the inbox (and count toward the unread badge), completions
 * still announce for AT — only the celebratory presentation stills.
 * Settings → General owns the switch. Mirrors home-news-pref.ts:
 * useSyncExternalStore keeps every subscriber live across same-tab writes
 * and cross-tab storage events.
 */

import { useSyncExternalStore } from "react";
import {
  readAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "./app-preferences.ts";

const CELEBRATIONS_KEY = "cave:celebrations-enabled";

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function readFromStorage(): boolean {
  return readAppPreferences().general.celebrations;
}

export function readCelebrationsEnabled(): boolean {
  if (cached === null) cached = readFromStorage();
  return cached;
}

export function writeCelebrationsEnabled(enabled: boolean) {
  cached = enabled;
  updateAppPreferences({ general: { celebrations: enabled } });
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CELEBRATIONS_KEY, enabled ? "true" : "false");
    }
  } catch {
    /* private mode — the in-memory cache still drives this tab */
  }
  notify();
}

subscribeAppPreferences(() => {
  cached = null;
  notify();
});

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== CELEBRATIONS_KEY) return;
    cached = null;
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** Live view of the pref — re-renders on same-tab writes and cross-tab changes. */
export function useCelebrationsEnabled(): boolean {
  return useSyncExternalStore(subscribe, readCelebrationsEnabled, () => true);
}
