/**
 * Journal memory constellation — the entry pane's generated "Visual"
 * ("Memories Prototype" redesign): a deterministic constellation sketch
 * seeded by the entry's date, with spokes from a hub, a few arcs, and
 * color-indexed stars.
 *
 * Pure geometry only (the SVG lives in journal-constellation.tsx): the same
 * date + bump always yields the same sketch, so nothing needs a server.
 * Regenerating bumps the seed; the per-date bump persists in localStorage.
 */

export type ConstellationPoint = {
  x: number;
  y: number;
  r: number;
  /** Index into the renderer's token-based palette. */
  c: number;
};

export const CONSTELLATION_VIEW = { width: 640, height: 200, hubX: 320, hubY: 100 } as const;
export const CONSTELLATION_COLOR_COUNT = 4;

/** Fold a date slug (and regeneration bump) into a positive LCG seed. */
export function constellationSeed(date: string, bump: number): number {
  let sd = 0;
  for (const ch of date) sd = (sd * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(sd) + bump * 977;
}

/** Park–Miller LCG points: 8–13 stars scattered on an ellipse around the hub. */
export function constellationPoints(seed: number): ConstellationPoint[] {
  let rs = (seed % 2147483646) + 1;
  const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  const points: ConstellationPoint[] = [];
  const count = 8 + Math.floor(rnd() * 6);
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2;
    const radius = 34 + rnd() * 78;
    points.push({
      x: CONSTELLATION_VIEW.hubX + Math.cos(angle) * radius * 1.4,
      y: CONSTELLATION_VIEW.hubY + Math.sin(angle) * radius * 0.62,
      r: 2.5 + rnd() * 3,
      c: Math.floor(rnd() * CONSTELLATION_COLOR_COUNT),
    });
  }
  return points;
}

// ── Per-date seed-bump persistence ───────────────────────────────────────────
// `{ [date]: bump }` — presence means "a visual was generated for this day";
// regenerating increments the bump. Pruned to the newest entries so the map
// never grows unbounded.

const STORAGE_KEY = "cave:journal:visuals";
const MAX_STORED_VISUALS = 90;

export function readStoredVisualBumps(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [date, bump] of Object.entries(parsed)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof bump === "number" && Number.isFinite(bump)) {
        out[date] = bump;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeStoredVisualBump(date: string, bump: number): Record<string, number> {
  const next = { ...readStoredVisualBumps(), [date]: bump };
  const dates = Object.keys(next).sort();
  while (dates.length > MAX_STORED_VISUALS) {
    const oldest = dates.shift();
    if (oldest) delete next[oldest];
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable — the visual just won't survive a reload
    }
  }
  return next;
}
