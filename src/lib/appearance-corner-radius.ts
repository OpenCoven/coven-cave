/**
 * UI corner radius — the global roundedness of buttons, inputs, cards, and the
 * familiar switcher pill.
 *
 * The app's chrome is built on four radius tokens declared in :root
 * (src/app/globals.css): `--radius` (the shadcn base, from which
 * `--radius-sm/md/lg/xl` are derived via calc), `--radius-control` (buttons,
 * inputs, rows), `--radius-card` (panels, cards), and `--radius-pill` (the
 * signature 999px pill — composer icon buttons and chips). Overriding those on
 * <html> rescales every surface that uses them at once, so a single setting
 * standardizes the whole UI instead of touching each component.
 *
 * Mirrors src/lib/reading-width.ts: a small enum persisted in localStorage and
 * applied to <html>. The default level removes the overrides so the :root token
 * values apply unchanged.
 *
 * NOTE: the level → CSS values below are duplicated, as string literals, in the
 * flash-free boot block inside src/components/theme-script.tsx (which runs
 * before any module resolves). Keep both in sync when changing values.
 */
export const CORNER_RADIUS_KEY = "cave:corner-radius";

export const CORNER_RADIUS_OPTIONS = ["sharp", "default", "round"] as const;

export type CornerRadius = (typeof CORNER_RADIUS_OPTIONS)[number];

// Literal type (not the wider CornerRadius) so `=== DEFAULT_CORNER_RADIUS`
// narrows "default" out of the union in applyCornerRadius.
export const DEFAULT_CORNER_RADIUS = "default" as const;

export const CORNER_RADIUS_LABELS: Record<CornerRadius, string> = {
  sharp: "Sharp",
  default: "Default",
  round: "Round",
};

/** Per-level token values. `default` is intentionally absent — see {@link CORNER_RADIUS_VALUES}. */
type RadiusVars = { base: string; control: string; card: string; pill: string };

/**
 * Token values per level. `default` is omitted on purpose: applying it removes
 * the inline overrides so the :root values (--radius 0.625rem / --radius-control
 * 8px / --radius-card 12px / --radius-pill 999px) take over. `pill` squares the
 * signature composer pill at `sharp` and keeps the full capsule at `round`.
 */
export const CORNER_RADIUS_VALUES: Record<Exclude<CornerRadius, "default">, RadiusVars> = {
  sharp: { base: "0.125rem", control: "2px", card: "4px", pill: "4px" },
  round: { base: "0.875rem", control: "12px", card: "16px", pill: "999px" },
};

export function normalizeCornerRadius(value: unknown): CornerRadius {
  return CORNER_RADIUS_OPTIONS.includes(value as CornerRadius)
    ? (value as CornerRadius)
    : DEFAULT_CORNER_RADIUS;
}

export function readCornerRadius(): CornerRadius {
  const central = normalizeCornerRadius(readAppPreferences().appearance.cornerRadius);
  if (central !== DEFAULT_CORNER_RADIUS || readAppPreferences().initialized) return central;
  if (typeof window === "undefined") return DEFAULT_CORNER_RADIUS;
  try {
    return normalizeCornerRadius(window.localStorage.getItem(CORNER_RADIUS_KEY));
  } catch {
    return DEFAULT_CORNER_RADIUS;
  }
}

/**
 * Apply the level: override `--radius`, `--radius-control`, `--radius-card`,
 * and `--radius-pill` on <html> (or remove them for the default so the :root
 * values apply) and persist the choice.
 */
export function applyCornerRadius(level: CornerRadius, options: { persist?: boolean } = {}) {
  if (typeof document === "undefined") return;
  const normalized = normalizeCornerRadius(level);
  if (options.persist !== false) {
    updateAppPreferences({ appearance: { cornerRadius: normalized } });
  }
  const root = document.documentElement;
  if (normalized === DEFAULT_CORNER_RADIUS) {
    root.style.removeProperty("--radius");
    root.style.removeProperty("--radius-control");
    root.style.removeProperty("--radius-card");
    root.style.removeProperty("--radius-pill");
  } else {
    const vars = CORNER_RADIUS_VALUES[normalized];
    root.style.setProperty("--radius", vars.base);
    root.style.setProperty("--radius-control", vars.control);
    root.style.setProperty("--radius-card", vars.card);
    root.style.setProperty("--radius-pill", vars.pill);
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CORNER_RADIUS_KEY, normalized);
  } catch {
    /* ignore unavailable storage */
  }
}
import { readAppPreferences, updateAppPreferences } from "./app-preferences.ts";
