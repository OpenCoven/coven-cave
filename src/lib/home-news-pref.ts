"use client";

/**
 * Home news carousel preference — opt-out toggle for the News (media
 * headlines) row of the home Daily-summary strip.
 *
 * Default ON; Settings → General owns the switch (the row itself has no
 * inline dismiss). `cave:home-news-enabled` stores "false" to opt out —
 * absence means enabled, matching the mobile-mode pref convention.
 * useSyncExternalStore keeps every subscriber (the home carousel, the
 * settings row) live-synced with same-tab writes and cross-tab storage
 * events.
 */

import { useSyncExternalStore } from "react";
import {
  readAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "./app-preferences.ts";

const HOME_NEWS_KEY = "cave:home-news-enabled";

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

function readFromStorage(): boolean {
  return readAppPreferences().general.newsHeadlines;
}

export function readHomeNewsEnabled(): boolean {
  if (cached === null) cached = readFromStorage();
  return cached;
}

export function writeHomeNewsEnabled(enabled: boolean) {
  cached = enabled;
  updateAppPreferences({ general: { newsHeadlines: enabled } });
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HOME_NEWS_KEY, enabled ? "true" : "false");
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
    if (e.key !== HOME_NEWS_KEY) return;
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
export function useHomeNewsEnabled(): boolean {
  return useSyncExternalStore(subscribe, readHomeNewsEnabled, () => true);
}
