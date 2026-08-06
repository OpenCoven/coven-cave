/**
 * foil/field — determinism primitives and the halftone / SDF mathematics.
 *
 * Isomorphic on purpose: nothing here touches the DOM, `sharp`, or any Node
 * built-in, so the same code renders a live preview in the summoning circle and
 * a print-resolution plate on the server. Every mark is a closed-form
 * expression evaluated per pixel — there is no sampling order and no
 * accumulation buffer, which is what makes output reproducible.
 *
 * The reference implementation and its full rationale live in
 * `scripts/foil-forge/`; this is the typed, browser-safe port.
 */

/* ── Determinism ─────────────────────────────────────────────────────────── */

/** FNV-1a, 32-bit. Stable across engines, unlike int-coercion string folds. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fold inputs into one seed. Argument ORDER is part of the contract — changing
 *  it changes every plate a familiar has ever been shown. */
export function deriveSeed(...parts: Array<string | number | null | undefined>): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === "number" && Number.isFinite(p) ? `#${Math.trunc(p)}` : String(p ?? "");
    h = hashString(`${h}|${s}`) >>> 0;
  }
  return h >>> 0;
}

export type Rng = {
  (): number;
  float(lo: number, hi: number): number;
  int(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  bool(p?: number): boolean;
};

/** mulberry32 — small, fast, sufficient for layout jitter. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.float = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
  next.bool = (p = 0.5) => next() < p;
  return next;
}

export const VARIATION_SCALE = { low: 0.35, medium: 1, high: 1.85 } as const;
export type VariationLevel = keyof typeof VARIATION_SCALE;
export const variationScale = (level: VariationLevel | undefined): number =>
  VARIATION_SCALE[level ?? "medium"];

/* ── Small maths ─────────────────────────────────────────────────────────── */

const TAU = Math.PI * 2;

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);

export const smoothstep = (e0: number, e1: number, x: number): number => {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/* ── Density falloff curves ──────────────────────────────────────────────── */

/**
 * Maps normalised radius (0 at centre, 1 at rim) to dot coverage. This single
 * function decides whether the same lattice reads as a sphere, a bloom or a set
 * of rings — it is the biggest lever on how a foil looks.
 */
export const FALLOFFS: Record<string, (t: number) => number> = {
  linear: (t) => 1 - t,
  gaussian: (t) => Math.exp(-(t * t) * 3.2),
  /** Lambertian shading of a lit sphere — the classic halftone sphere. */
  sphere: (t) => {
    if (t >= 1) return 0;
    return clamp(0.18 + 0.92 * Math.sqrt(Math.max(0, 1 - t * t)));
  },
  annulus: (t) => Math.exp(-((t - 0.62) ** 2) / 0.035),
  banded: (t) => clamp((1 - t) * (0.35 + 0.75 * (0.5 + 0.5 * Math.cos(t * Math.PI * 9)))),
  disc: (t) => smoothstep(1, 0.82, t),
  /**
   * Constant to the rim. Wrong for a standalone foil — it has no focal mass —
   * but it is the RIGHT carrier when the plate will be multiplied by a mask,
   * because then the mask must supply the shape and the plate only the texture.
   * Using a composed plate under a mask punches holes in the masked subject and
   * reads as a misalignment bug.
   */
  flat: () => 1,
};

export const FALLOFF_NAMES = Object.keys(FALLOFFS);

/* ── Radial halftone ─────────────────────────────────────────────────────── */

export type HalftoneSpec = {
  cx: number;
  cy: number;
  radius: number;
  ringPitch: number;
  dotScale: number;
  falloff: string;
  rotation: number;
  twist?: number;
  gamma?: number;
  minCells?: number;
};

/**
 * Cells sit in concentric rings, with per-ring cell counts scaled to
 * circumference so cell area stays roughly constant. Sampled per pixel by
 * locating the containing cell rather than iterating dots, so cost is
 * O(pixels) no matter how many dots there are.
 */
export function makeHalftone(spec: HalftoneSpec): (px: number, py: number, aa: number) => number {
  const {
    cx, cy, radius, ringPitch, dotScale, falloff, rotation,
    twist = 0, gamma = 1, minCells = 6,
  } = spec;

  const curve = FALLOFFS[falloff] ?? FALLOFFS.sphere;
  const rings = Math.max(1, Math.round(radius / ringPitch));

  return (px, py, aa) => {
    const dx = px - cx;
    const dy = py - cy;
    // Inline sqrt, not Math.hypot: hypot's overflow guard costs roughly an
    // order of magnitude in a per-pixel loop.
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r > radius + ringPitch) return 0;

    const ri = Math.min(rings - 1, Math.floor(r / ringPitch));
    const rc = (ri + 0.5) * ringPitch;

    let weight = curve(clamp(rc / radius));
    if (gamma !== 1) weight = Math.pow(clamp(weight), gamma);
    if (weight <= 0.001) return 0;

    const cells = Math.max(minCells, Math.round((TAU * rc) / ringPitch));
    // Half-cell stagger on odd rings stops the lattice reading as spokes.
    const spin = rotation + twist * (rc / radius) * TAU + (ri % 2) * (Math.PI / cells);
    let theta = Math.atan2(dy, dx) - spin;
    theta = ((theta % TAU) + TAU) % TAU;

    const ai = Math.floor((theta / TAU) * cells);
    const ac = ((ai + 0.5) / cells) * TAU + spin;
    const ccx = cx + Math.cos(ac) * rc;
    const ccy = cy + Math.sin(ac) * rc;

    const dotR = ringPitch * dotScale * weight;
    if (dotR <= 0) return 0;

    const ex = px - ccx;
    const ey = py - ccy;
    return 1 - smoothstep(dotR - aa, dotR + aa, Math.sqrt(ex * ex + ey * ey));
  };
}

/* ── Signed distance functions ───────────────────────────────────────────── */

/** Negative inside, positive outside, in pixels. Compose with min/max. */
export const sdf = {
  circle: (px: number, py: number, cx: number, cy: number, r: number): number => {
    const dx = px - cx, dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy) - r;
  },
  ring: (px: number, py: number, cx: number, cy: number, r: number, w: number): number => {
    const dx = px - cx, dy = py - cy;
    return Math.abs(Math.sqrt(dx * dx + dy * dy) - r) - w * 0.5;
  },
  polygon: (px: number, py: number, cx: number, cy: number, r: number, n: number, rot = 0): number => {
    const dx = px - cx, dy = py - cy;
    const a = Math.atan2(dy, dx) - rot;
    const seg = TAU / n;
    const aa = a - seg * Math.round(a / seg);
    return Math.sqrt(dx * dx + dy * dy) * Math.cos(aa) - r * Math.cos(seg / 2);
  },
  box: (px: number, py: number, cx: number, cy: number, hw: number, hh: number, rot = 0): number => {
    const c = Math.cos(-rot), s = Math.sin(-rot);
    const dx = px - cx, dy = py - cy;
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    const qx = Math.abs(rx) - hw, qy = Math.abs(ry) - hh;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0);
    return Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0);
  },
  arc: (px: number, py: number, cx: number, cy: number, r: number, w: number, rot: number, sweep: number): number => {
    const dx = px - cx, dy = py - cy;
    let a = Math.atan2(dy, dx) - rot;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    const half = sweep * 0.5;
    if (Math.abs(a) <= half) return Math.abs(Math.sqrt(dx * dx + dy * dy) - r) - w * 0.5;
    const capA = rot + (a > 0 ? half : -half);
    const gx = px - (cx + Math.cos(capA) * r);
    const gy = py - (cy + Math.sin(capA) * r);
    return Math.sqrt(gx * gx + gy * gy) - w * 0.5;
  },
  segment: (px: number, py: number, ax: number, ay: number, bx: number, by: number, w: number): number => {
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const len2 = vx * vx + vy * vy || 1;
    const t = clamp((wx * vx + wy * vy) / len2);
    const ux = wx - vx * t, uy = wy - vy * t;
    return Math.sqrt(ux * ux + uy * uy) - w * 0.5;
  },
  chevron: (px: number, py: number, cx: number, cy: number, size: number, w: number, rot = 0): number => {
    const c = Math.cos(-rot), s = Math.sin(-rot);
    const dx = px - cx, dy = py - cy;
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return Math.min(
      sdf.segment(rx, ry, -size, -size, size, 0, w),
      sdf.segment(rx, ry, -size, size, size, 0, w),
    );
  },
};

/** Signed distance → antialiased coverage. */
export const fill = (d: number, aa: number): number => 1 - smoothstep(-aa, aa, d);
