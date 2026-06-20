"use client";

/**
 * User preference for how the familiar control renders in the top bars:
 *
 *   • "avatars"  — a row of one-tap avatars (pinned + most-recent) beside the
 *                  switcher menu (the default; see FamiliarQuickSwitch).
 *   • "dropdown" — just the account-style switcher menu, no avatar strip.
 *
 * Cave-local, persisted in localStorage under `cave:familiar-switcher-style`.
 * Reactive via useSyncExternalStore so the top bars re-render the moment the
 * Settings control flips it. Same shape as cave-familiar-order.
 */

import { useSyncExternalStore } from "react";

export const FAMILIAR_SWITCHER_STYLE_KEY = "cave:familiar-switcher-style";

export const FAMILIAR_SWITCHER_STYLE_OPTIONS = ["avatars", "dropdown"] as const;

export type FamiliarSwitcherStyle = (typeof FAMILIAR_SWITCHER_STYLE_OPTIONS)[number];

export const DEFAULT_FAMILIAR_SWITCHER_STYLE = "avatars" as const;

export const FAMILIAR_SWITCHER_STYLE_LABELS: Record<FamiliarSwitcherStyle, string> = {
  avatars: "Avatars",
  dropdown: "Dropdown",
};

export function normalizeFamiliarSwitcherStyle(value: unknown): FamiliarSwitcherStyle {
  return FAMILIAR_SWITCHER_STYLE_OPTIONS.includes(value as FamiliarSwitcherStyle)
    ? (value as FamiliarSwitcherStyle)
    : DEFAULT_FAMILIAR_SWITCHER_STYLE;
}

let cached: FamiliarSwitcherStyle | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function read(): FamiliarSwitcherStyle {
  if (typeof window === "undefined") return DEFAULT_FAMILIAR_SWITCHER_STYLE;
  try {
    return normalizeFamiliarSwitcherStyle(window.localStorage.getItem(FAMILIAR_SWITCHER_STYLE_KEY));
  } catch {
    return DEFAULT_FAMILIAR_SWITCHER_STYLE;
  }
}

function getSnapshot(): FamiliarSwitcherStyle {
  if (cached === null) cached = read();
  return cached;
}

/** Persist the preference and notify subscribers. */
export function setFamiliarSwitcherStyle(style: FamiliarSwitcherStyle): void {
  const normalized = normalizeFamiliarSwitcherStyle(style);
  cached = normalized;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(FAMILIAR_SWITCHER_STYLE_KEY, normalized); } catch { /* ignore */ }
  }
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === FAMILIAR_SWITCHER_STYLE_KEY) {
      cached = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getServerSnapshot = () => DEFAULT_FAMILIAR_SWITCHER_STYLE;

/** React hook: the current familiar-switcher style. Re-renders on change. */
export function useFamiliarSwitcherStyle(): FamiliarSwitcherStyle {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
