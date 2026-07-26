import { readAppPreferences, updateAppPreferences } from "./app-preferences.ts";

export const SCREEN_SCALE_KEY = "cave:screen-scale";

export const SCREEN_SCALE_OPTIONS = [100, 110, 125, 150] as const;

export type ScreenScale = (typeof SCREEN_SCALE_OPTIONS)[number];

export const DEFAULT_SCREEN_SCALE: ScreenScale = 100;

export const SCREEN_SCALE_EVENT = "cave:screen-scale-change";

export function normalizeScreenScale(value: unknown): ScreenScale {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return SCREEN_SCALE_OPTIONS.includes(parsed as ScreenScale)
    ? (parsed as ScreenScale)
    : DEFAULT_SCREEN_SCALE;
}

export function readScreenScale(): ScreenScale {
  const central = normalizeScreenScale(readAppPreferences().appearance.screenScale);
  if (central !== DEFAULT_SCREEN_SCALE || readAppPreferences().initialized) return central;
  if (typeof window === "undefined") return DEFAULT_SCREEN_SCALE;
  try {
    return normalizeScreenScale(window.localStorage.getItem(SCREEN_SCALE_KEY));
  } catch {
    return DEFAULT_SCREEN_SCALE;
  }
}

export function applyScreenScale(scale: ScreenScale, options: { persist?: boolean } = {}) {
  if (typeof document === "undefined") return;
  const normalized = normalizeScreenScale(scale);
  document.documentElement.setAttribute("data-screen-scale", String(normalized));
  if (options.persist !== false) {
    updateAppPreferences({ appearance: { screenScale: normalized } });
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCREEN_SCALE_KEY, String(normalized));
  } catch {
    /* ignore unavailable storage */
  }
  window.dispatchEvent(new CustomEvent(SCREEN_SCALE_EVENT, { detail: { scale: normalized } }));
}

export function stepScreenScale(current: ScreenScale, direction: 1 | -1): ScreenScale {
  const idx = SCREEN_SCALE_OPTIONS.indexOf(normalizeScreenScale(current));
  const next = Math.max(0, Math.min(SCREEN_SCALE_OPTIONS.length - 1, idx + direction));
  return SCREEN_SCALE_OPTIONS[next];
}
