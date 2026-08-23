/**
 * UI corner radius — the global roundedness of buttons, inputs, cards, and the
 * familiar switcher pill.
 *
 * The app's chrome is built on five radius tokens declared in :root
 * (src/app/globals.css): `--radius` (the shadcn base, from which
 * `--radius-sm/md/lg/xl` are derived via calc), `--radius-control` (buttons,
 * inputs, rows), `--radius-card` (cards), `--radius-panel` (modals, sheets,
 * and full panels — the outermost step of the ladder), and `--radius-pill`
 * (the signature 999px pill — composer icon buttons and chips). Overriding
 * those on <html> rescales every surface that uses them at once, so a single
 * setting standardizes the whole UI instead of touching each component.
 *
 * `--radius-panel` MUST stay in this set. It is a peer step of the documented
 * scale (docs/coven-design-language.md §2: control 8 · card 12 · panel 16),
 * themes.css rescales it alongside its siblings, and ~70 surfaces consume it.
 * While it was omitted here, picking "Sharp" left every modal and panel at a
 * 16px corner while the cards nested inside them dropped to 4px — the panel
 * read as rounder than its own contents, which is the inconsistency this
 * setting exists to prevent.
 *
 * Mirrors src/lib/reading-width.ts: a small enum persisted in localStorage and
 * applied to <html>. The default level removes the overrides so the :root token
 * values apply unchanged.
 *
 * NOTE: the level → CSS values below are duplicated, as string literals, in the
 * flash-free boot block — `public/scripts/theme-init.js` (the `RADII` table),
 * loaded by src/components/theme-script.tsx. It runs before any module
 * resolves, so it cannot import them. Keep both in sync when changing values;
 * src/components/theme-script.test.ts asserts the same numbers on both sides,
 * so a one-sided edit fails there rather than shipping a boot/runtime flash.
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
type RadiusVars = {
  base: string;
  control: string;
  card: string;
  panel: string;
  pill: string;
};

/**
 * Token values per level. `default` is omitted on purpose: applying it removes
 * the inline overrides so the :root values (--radius 0.625rem / --radius-control
 * 8px / --radius-card 12px / --radius-panel 16px / --radius-pill 999px) take
 * over. `pill` squares the signature composer pill at `sharp` and keeps the
 * full capsule at `round`.
 *
 * control < card < panel holds at every level, and each level keeps its own
 * even step, so the nesting order of the ladder survives rescaling:
 *   sharp   2 · 4 · 6    (step 2 — the compressed ladder)
 *   default 8 · 12 · 16  (step 4 — :root)
 *   round   12 · 16 · 20 (step 4)
 */
export const CORNER_RADIUS_VALUES: Record<Exclude<CornerRadius, "default">, RadiusVars> = {
  sharp: { base: "0.125rem", control: "2px", card: "4px", panel: "6px", pill: "4px" },
  round: { base: "0.875rem", control: "12px", card: "16px", panel: "20px", pill: "999px" },
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
 * `--radius-panel`, and `--radius-pill` on <html> (or remove them for the
 * default so the :root values apply) and persist the choice.
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
    root.style.removeProperty("--radius-panel");
    root.style.removeProperty("--radius-pill");
  } else {
    const vars = CORNER_RADIUS_VALUES[normalized];
    root.style.setProperty("--radius", vars.base);
    root.style.setProperty("--radius-control", vars.control);
    root.style.setProperty("--radius-card", vars.card);
    root.style.setProperty("--radius-panel", vars.panel);
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
