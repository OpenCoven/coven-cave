/**
 * Pure state helpers for the shared SurfaceRail primitive
 * (src/components/ui/surface-rail.tsx): width clamping, localStorage
 * persistence, and keyboard resize steps. Dependency-free so the unit suite
 * can exercise them directly.
 */

export const SURFACE_RAIL_DEFAULT_WIDTH = 280;
export const SURFACE_RAIL_MIN_WIDTH = 200;
export const SURFACE_RAIL_MAX_WIDTH = 440;
export const SURFACE_RAIL_COLLAPSED_WIDTH = 56;
export const SURFACE_RAIL_KEY_STEP = 16;

export type SurfaceRailPrefs = { width: number; open: boolean };

/** Anything that quacks like Storage — lets tests pass a plain fake. */
export type SurfaceRailStorage = Pick<Storage, "getItem" | "setItem">;

export function surfaceRailWidthKey(storageKey: string): string {
  return `${storageKey}:width`;
}

export function surfaceRailOpenKey(storageKey: string): string {
  return `${storageKey}:open`;
}

/** Clamp a candidate width to the rail's resizable range (200–440). */
export function clampSurfaceRailWidth(
  width: number,
  fallback: number = SURFACE_RAIL_DEFAULT_WIDTH,
): number {
  const base = Number.isFinite(width) ? width : fallback;
  return Math.min(
    SURFACE_RAIL_MAX_WIDTH,
    Math.max(SURFACE_RAIL_MIN_WIDTH, Math.round(base)),
  );
}

/**
 * Read persisted rail prefs. Storage failures (private mode, quota, JSON
 * garbage) silently fall back to defaults — the rail must always render.
 */
export function readSurfaceRailPrefs(
  storage: SurfaceRailStorage | null | undefined,
  storageKey: string,
  defaultWidth: number = SURFACE_RAIL_DEFAULT_WIDTH,
): SurfaceRailPrefs {
  let width = clampSurfaceRailWidth(defaultWidth);
  let open = true;
  if (!storage) return { width, open };
  try {
    const rawWidth = storage.getItem(surfaceRailWidthKey(storageKey));
    if (rawWidth != null) width = clampSurfaceRailWidth(Number.parseFloat(rawWidth), width);
    open = storage.getItem(surfaceRailOpenKey(storageKey)) !== "0";
  } catch {
    // Storage unavailable — defaults already set.
  }
  return { width, open };
}

export function writeSurfaceRailWidth(
  storage: SurfaceRailStorage | null | undefined,
  storageKey: string,
  width: number,
): void {
  try {
    storage?.setItem(surfaceRailWidthKey(storageKey), String(clampSurfaceRailWidth(width)));
  } catch {
    // Persistence is best-effort.
  }
}

export function writeSurfaceRailOpen(
  storage: SurfaceRailStorage | null | undefined,
  storageKey: string,
  open: boolean,
): void {
  try {
    storage?.setItem(surfaceRailOpenKey(storageKey), open ? "1" : "0");
  } catch {
    // Persistence is best-effort.
  }
}

/**
 * Arrow-key resize for the separator (accessible-splitter idiom): Left
 * narrows, Right widens, ±16px, clamped. Returns null for unrelated keys.
 */
export function surfaceRailKeyboardResize(
  width: number,
  key: string,
  step: number = SURFACE_RAIL_KEY_STEP,
): number | null {
  if (key === "ArrowLeft") return clampSurfaceRailWidth(width - step);
  if (key === "ArrowRight") return clampSurfaceRailWidth(width + step);
  return null;
}
