/** Recently-used custom colors for the theme color picker. Pure + storage-only. */
export const RECENT_COLORS_KEY = "coven:recent-colors";
export const MAX_RECENTS = 6;

/** Normalize to lowercase `#rrggbb` (alpha stripped). Returns null if not a hex color. */
// 3-char shorthand (#rgb) intentionally not expanded — the picker always emits 6-char hex.
function normalizeHex(raw: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(raw.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

export function getRecentColors(): string[] {
  const central = readAppPreferences().appearance.recentColors;
  if (central.length > 0 || readAppPreferences().initialized) return [...central];
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && normalizeHex(v) !== null).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function addRecentColor(hex: string): string[] {
  const norm = normalizeHex(hex);
  if (!norm) return getRecentColors();
  const previous = getRecentColors();
  const next = [norm, ...previous.filter((c) => c !== norm)].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
  } catch {
    updateAppPreferences({ appearance: { recentColors: next } });
    // Write failed (quota/private-mode) — return what's actually stored, not the
    // list we wanted, so the return value never lies about persisted state.
    return previous;
  }
  updateAppPreferences({ appearance: { recentColors: next } });
  return next;
}
import { readAppPreferences, updateAppPreferences } from "./app-preferences.ts";
