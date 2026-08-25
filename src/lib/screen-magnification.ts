import { readAppPreferences, updateAppPreferences } from "./app-preferences.ts";

export const SCREEN_SCALE_KEY = "cave:screen-scale";

export const SCREEN_SCALE_OPTIONS = [100, 105, 125, 150] as const;

/**
 * Steps this app used to offer, mapped to the nearest surviving one.
 *
 * The first step above 100 was 110 — a 10% jump off the default, which reads
 * as dramatic rather than as the gentle nudge a first step should be. Moving
 * it to 105 would otherwise be silently destructive: `normalizeScreenScale`
 * answers anything outside SCREEN_SCALE_OPTIONS with the DEFAULT, so every
 * user already sitting on 110 would come back at 100 with their magnification
 * gone. For an accessibility setting, losing it is a worse outcome than the
 * step being coarse, so a legacy value lands on the nearest step that still
 * exists instead of resetting.
 */
const LEGACY_SCREEN_SCALES: Record<number, ScreenScale> = { 110: 105 };

export type ScreenScale = (typeof SCREEN_SCALE_OPTIONS)[number];

export const DEFAULT_SCREEN_SCALE: ScreenScale = 100;

export const SCREEN_SCALE_EVENT = "cave:screen-scale-change";

export function normalizeScreenScale(value: unknown): ScreenScale {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (SCREEN_SCALE_OPTIONS.includes(parsed as ScreenScale)) return parsed as ScreenScale;
  return LEGACY_SCREEN_SCALES[parsed] ?? DEFAULT_SCREEN_SCALE;
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
