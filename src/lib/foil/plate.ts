/**
 * foil/plate — layout, marks, and the greyscale rasteriser.
 *
 * Isomorphic: returns a raw single-channel buffer. The browser wraps it in
 * ImageData; the server hands it to `sharp`. Neither path is imported here.
 */

import {
  clamp, deriveSeed, fill, makeHalftone, makeRng, sdf, smoothstep,
  variationScale, type HalftoneSpec, type Rng, type VariationLevel,
} from "./field";

const TAU = Math.PI * 2;

/* ── Marks ───────────────────────────────────────────────────────────────── */

export type MarkPlacement = { cx: number; cy: number; s: number; rot: number; w: number };
type MarkDraw = (px: number, py: number, o: MarkPlacement, aa: number) => number;

/**
 * A curated vocabulary. A theme SELECTS from this table — it never invents
 * geometry — which is what keeps a whole set of familiars looking like one set.
 */
export const MARKS: Record<string, { tags: string[]; draw: MarkDraw }> = {
  eclipse: {
    tags: ["round", "negative", "bold"],
    draw: (px, py, o, aa) =>
      clamp(
        fill(sdf.circle(px, py, o.cx, o.cy, o.s), aa) -
        fill(sdf.circle(px, py, o.cx + o.s * 0.42, o.cy - o.s * 0.3, o.s * 0.86), aa),
      ),
  },
  orbit: {
    tags: ["round", "node", "technical"],
    draw: (px, py, o, aa) => {
      let c = fill(sdf.circle(px, py, o.cx, o.cy, o.s * 0.17), aa);
      for (const [r, wm] of [[0.46, 1], [0.72, 0.72], [1, 0.5]] as const) {
        c = Math.max(c, fill(sdf.ring(px, py, o.cx, o.cy, o.s * r, o.w * wm), aa));
      }
      return c;
    },
  },
  reticle: {
    tags: ["round", "technical", "precision"],
    draw: (px, py, o, aa) => {
      let c = fill(sdf.ring(px, py, o.cx, o.cy, o.s * 0.78, o.w), aa);
      for (let i = 0; i < 4; i++) {
        const a = o.rot + (i * TAU) / 4;
        c = Math.max(c, fill(sdf.segment(
          px, py,
          o.cx + Math.cos(a) * o.s * 0.9, o.cy + Math.sin(a) * o.s * 0.9,
          o.cx + Math.cos(a) * o.s * 1.22, o.cy + Math.sin(a) * o.s * 1.22,
          o.w,
        ), aa));
      }
      return Math.max(c, fill(sdf.circle(px, py, o.cx, o.cy, o.s * 0.1), aa));
    },
  },
  prism: {
    tags: ["angular", "wire", "bold"],
    draw: (px, py, o, aa) => {
      const outer = sdf.polygon(px, py, o.cx, o.cy, o.s, 3, o.rot);
      return clamp(fill(outer, aa) - fill(outer + o.w, aa));
    },
  },
  hexcell: {
    tags: ["angular", "technical", "lattice"],
    draw: (px, py, o, aa) => {
      const outer = sdf.polygon(px, py, o.cx, o.cy, o.s, 6, o.rot);
      return Math.max(
        clamp(fill(outer, aa) - fill(outer + o.w, aa)),
        fill(sdf.polygon(px, py, o.cx, o.cy, o.s * 0.34, 6, o.rot), aa),
      );
    },
  },
  blade: {
    tags: ["angular", "blade", "motion"],
    draw: (px, py, o, aa) => {
      let c = 0;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * o.s * 0.44;
        c = Math.max(c, fill(sdf.chevron(
          px, py, o.cx + Math.cos(o.rot) * off, o.cy + Math.sin(o.rot) * off,
          o.s * 0.5, o.w, o.rot,
        ), aa));
      }
      return c;
    },
  },
  aperture: {
    tags: ["round", "technical", "precision"],
    draw: (px, py, o, aa) => {
      let c = 0;
      const blades = 6;
      for (let i = 0; i < blades; i++) {
        const a = o.rot + (i * TAU) / blades;
        c = Math.max(c, fill(sdf.arc(px, py, o.cx, o.cy, o.s * 0.82, o.w * 1.5, a, (TAU / blades) * 0.62), aa));
      }
      return c;
    },
  },
  lattice: {
    tags: ["lattice", "grid", "structure"],
    draw: (px, py, o, aa) => {
      const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
      const dx = px - o.cx, dy = py - o.cy;
      const rx = dx * c - dy * s, ry = dx * s + dy * c;
      if (Math.abs(rx) > o.s || Math.abs(ry) > o.s) return 0;
      const pitch = o.s / 4.5;
      const m = Math.abs((((ry % pitch) + pitch) % pitch) - pitch * 0.5);
      return (1 - smoothstep(o.w * 0.5 - aa, o.w * 0.5 + aa, m)) *
        (1 - smoothstep(o.s * 0.7, o.s, Math.abs(rx)));
    },
  },
  sigil: {
    tags: ["star", "arcane", "radial"],
    draw: (px, py, o, aa) => {
      let d = 1e9;
      for (let i = 0; i < 4; i++) {
        d = Math.min(d, sdf.box(px, py, o.cx, o.cy, o.s, o.s * 0.085, o.rot + (i * Math.PI) / 4));
      }
      return Math.max(fill(d, aa), fill(sdf.circle(px, py, o.cx, o.cy, o.s * 0.14), aa));
    },
  },
  node: {
    tags: ["node", "network", "technical"],
    draw: (px, py, o, aa) => {
      let c = fill(sdf.circle(px, py, o.cx, o.cy, o.s * 0.13), aa);
      for (let i = 0; i < 3; i++) {
        const a = o.rot + (i * TAU) / 3;
        const nx = o.cx + Math.cos(a) * o.s * 0.8;
        const ny = o.cy + Math.sin(a) * o.s * 0.8;
        c = Math.max(c, fill(sdf.segment(px, py, o.cx, o.cy, nx, ny, o.w * 0.8), aa));
        c = Math.max(c, fill(sdf.circle(px, py, nx, ny, o.s * 0.11), aa));
      }
      return c;
    },
  },
  monolith: {
    tags: ["bold", "structure"],
    draw: (px, py, o, aa) => fill(sdf.box(px, py, o.cx, o.cy, o.s * 0.22, o.s, o.rot), aa),
  },
};

export const MARK_NAMES = Object.keys(MARKS);

const KEYWORDS: Array<[string[], string[]]> = [
  [["cyber", "mech", "machine", "android", "chrome", "circuit"], ["technical", "angular", "lattice"]],
  [["void", "null", "abyss", "shadow", "dark", "eclipse", "obsidian"], ["negative", "round", "bold"]],
  [["quantum", "particle", "wave", "flux", "entangle", "photon"], ["node", "round", "network"]],
  [["warrior", "blade", "war", "hunt", "strike", "reaper", "sever"], ["blade", "angular", "motion"]],
  [["trader", "market", "exchange", "ledger", "broker", "index"], ["lattice", "grid", "network"]],
  [["arcane", "occult", "rune", "sigil", "witch", "coven", "ritual"], ["arcane", "star", "radial"]],
  [["oracle", "seer", "augur", "divine", "scry", "research"], ["precision", "round", "radial"]],
  [["forge", "iron", "anvil", "smith", "steel", "code", "build"], ["bold", "structure", "angular"]],
  [["archive", "library", "record", "memory", "comms", "message"], ["grid", "structure", "lattice"]],
  [["storm", "bolt", "surge", "volt", "review"], ["motion", "angular", "blade"]],
];

const NEUTRAL = ["technical", "round", "precision"];

export function tagsForTheme(theme: string): string[] {
  const t = String(theme ?? "").toLowerCase();
  const hits: string[] = [];
  for (const [keys, tags] of KEYWORDS) if (keys.some((k) => t.includes(k))) hits.push(...tags);
  return hits.length ? hits : NEUTRAL.slice();
}

export function selectMarks(theme: string, rng: Rng, count: number): string[] {
  const weight = new Map<string, number>();
  for (const tag of tagsForTheme(theme)) weight.set(tag, (weight.get(tag) ?? 0) + 1);

  const scored = MARK_NAMES.map((name) => ({
    name,
    score: MARKS[name].tags.reduce((s, tag) => s + (weight.get(tag) ?? 0), 0),
    jitter: rng(),
  })).sort((a, b) => b.score - a.score || a.jitter - b.jitter);

  const out: string[] = [];
  for (const s of scored) {
    out.push(s.name);
    if (out.length === count) break;
  }
  return out;
}

/* ── Layout ──────────────────────────────────────────────────────────────── */

export const TEMPLATES = [
  "centered", "left-heavy", "triptych", "corner-anchor", "orbital", "split", "full-bleed",
] as const;
export type TemplateName = (typeof TEMPLATES)[number];

const PRIMARY_FALLOFFS = ["sphere", "gaussian", "annulus", "banded", "disc"];

type Layout = {
  template: string;
  falloff: string;
  halftones: HalftoneSpec[];
  slots: MarkPlacement[];
  basePitch: number;
};

function buildLayout(opts: {
  width: number; height: number; rng: Rng; variation: number;
  markCount: number; template?: string | null; pitchScale: number; falloff?: string | null;
}): Layout {
  const { width, height, rng, variation, markCount, pitchScale } = opts;
  const unit = Math.min(width, height);
  const j = (amount: number) => (rng() - 0.5) * 2 * amount * variation;

  // Draw unconditionally, then override. Skipping a draw when the caller forces
  // a value would shift every subsequent random number and silently change the
  // layout of an otherwise identical card.
  const autoTemplate = rng.pick(TEMPLATES);
  const name = opts.template ?? autoTemplate;
  const autoFalloff = rng.pick(PRIMARY_FALLOFFS);
  const falloff = opts.falloff ?? autoFalloff;

  // Never densify by rendering large and downsampling — resampling a fine
  // halftone aliases it into scanlines. Change the pitch instead.
  const basePitch = unit * (0.0165 + j(0.0035)) * pitchScale;
  const dotScale = 0.5 + j(0.09);
  const twist = rng.bool(0.35) ? (rng() - 0.5) * 0.34 * variation : 0;

  const halftones: HalftoneSpec[] = [];
  const slots: MarkPlacement[] = [];

  const push = (cx: number, cy: number, radius: number, over: Partial<{ pitchMul: number; dotMul: number; falloff: string; gamma: number }> = {}) => {
    halftones.push({
      cx: cx * width,
      cy: cy * height,
      radius: radius * unit,
      ringPitch: Math.max(4, basePitch * (over.pitchMul ?? 1)),
      dotScale: Math.max(0.16, Math.min(0.86, dotScale * (over.dotMul ?? 1))),
      falloff: over.falloff ?? falloff,
      rotation: rng() * TAU,
      twist,
      gamma: over.gamma ?? 1,
    });
  };
  const slot = (cx: number, cy: number, s: number, weightMul = 1) => {
    slots.push({ cx: cx * width, cy: cy * height, s: s * unit, rot: rng() * TAU, w: Math.max(2, unit * 0.0085 * weightMul) });
  };

  switch (name) {
    case "centered":
      push(0.5 + j(0.03), 0.44 + j(0.04), 0.46 + j(0.05));
      slot(0.5 + j(0.05), 0.44 + j(0.05), 0.15 + j(0.03));
      slot(0.22 + j(0.06), 0.8 + j(0.05), 0.075 + j(0.02), 0.8);
      break;
    case "left-heavy":
      push(0.22 + j(0.04), 0.4 + j(0.05), 0.52 + j(0.05));
      push(0.86 + j(0.04), 0.82 + j(0.05), 0.2 + j(0.04), { pitchMul: 0.62, falloff: "disc" });
      slot(0.7 + j(0.06), 0.36 + j(0.06), 0.13 + j(0.03));
      break;
    case "triptych":
      push(0.5 + j(0.02), 0.5 + j(0.03), 0.34 + j(0.03), { falloff: "banded" });
      push(0.12 + j(0.03), 0.22 + j(0.04), 0.17 + j(0.03), { pitchMul: 0.7 });
      push(0.88 + j(0.03), 0.78 + j(0.04), 0.17 + j(0.03), { pitchMul: 0.7 });
      slot(0.5 + j(0.04), 0.5 + j(0.04), 0.12 + j(0.02));
      break;
    case "corner-anchor":
      push(0.14 + j(0.04), 0.14 + j(0.04), 0.5 + j(0.05), { gamma: 1.25 });
      slot(0.68 + j(0.06), 0.66 + j(0.06), 0.17 + j(0.03));
      break;
    case "orbital":
      push(0.5 + j(0.03), 0.5 + j(0.03), 0.3 + j(0.03), { falloff: "annulus" });
      push(0.5 + j(0.03), 0.5 + j(0.03), 0.56 + j(0.05), { pitchMul: 1.5, dotMul: 0.62, falloff: "annulus" });
      slot(0.5 + j(0.03), 0.5 + j(0.03), 0.11 + j(0.02));
      break;
    // Even carrier across the whole frame, for masked use.
    case "full-bleed":
      push(0.5, 0.5, 0.78, { falloff: "flat" });
      slot(0.5, 0.5, 0.0001);
      break;
    case "split":
    default:
      push(0.3 + j(0.04), 0.28 + j(0.04), 0.36 + j(0.04));
      push(0.72 + j(0.04), 0.74 + j(0.04), 0.36 + j(0.04), { falloff: "disc", dotMul: 0.86 });
      slot(0.72 + j(0.05), 0.28 + j(0.06), 0.12 + j(0.03));
      break;
  }

  return { template: name, falloff, halftones, slots: slots.slice(0, Math.max(1, markCount)), basePitch };
}

/* ── Rasteriser ──────────────────────────────────────────────────────────── */

export type PlateOptions = {
  width: number;
  height: number;
  theme?: string;
  seed?: number | string;
  variation?: VariationLevel;
  markCount?: number;
  template?: TemplateName | null;
  falloff?: string | null;
  pitchScale?: number;
  contrast?: number;
};

export type PlateResult = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  meta: { seed: number; template: string; falloff: string; marks: string[]; ringPitch: number };
};

/**
 * Render a greyscale plate. The seed is derived from IDENTITY only (seed +
 * theme) — dimensions, variation, mark count and forced template/falloff are
 * presentation knobs, so one seed composes identically at any resolution and
 * the knobs stay orthogonal.
 */
export function renderPlate(opts: PlateOptions): PlateResult {
  const width = Math.max(8, Math.round(opts.width));
  const height = Math.max(8, Math.round(opts.height));
  const markCount = Math.min(3, Math.max(1, opts.markCount ?? 2));

  const seed = deriveSeed(opts.seed ?? 0, opts.theme ?? "");
  const rng = makeRng(seed);
  const variation = variationScale(opts.variation);

  const marks = selectMarks(opts.theme ?? "", rng, markCount);
  const layout = buildLayout({
    width, height, rng, variation, markCount,
    template: opts.template ?? null,
    falloff: opts.falloff ?? null,
    pitchScale: opts.pitchScale ?? 1,
  });

  const samplers = layout.halftones.map((h) => {
    const reach = h.radius + h.ringPitch;
    return { fn: makeHalftone(h), x0: h.cx - reach, x1: h.cx + reach, y0: h.cy - reach, y1: h.cy + reach };
  });
  const placements = layout.slots.map((slot, i) => {
    const reach = slot.s * 1.9 + slot.w * 2;
    return {
      slot, draw: MARKS[marks[i % marks.length]].draw,
      x0: slot.cx - reach, x1: slot.cx + reach, y0: slot.cy - reach, y1: slot.cy + reach,
    };
  });

  const data = new Uint8ClampedArray(width * height);
  const aa = 0.7;
  const shoulder = clamp(0.5 * (1 - (opts.contrast ?? 0.86)), 0.004, 0.5);
  const lo = 0.5 - shoulder;
  const hi = 0.5 + shoulder;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let cover = 0;
      // Bounding-box reject first: most pixels exit on four comparisons rather
      // than a sqrt and an atan2.
      for (let i = 0; i < samplers.length && cover < 1; i++) {
        const s = samplers[i];
        if (px < s.x0 || px > s.x1 || py < s.y0 || py > s.y1) continue;
        const c = s.fn(px, py, aa);
        if (c > cover) cover = c;
      }
      for (let i = 0; i < placements.length && cover < 1; i++) {
        const p = placements[i];
        if (px < p.x0 || px > p.x1 || py < p.y0 || py > p.y1) continue;
        const c = p.draw(px, py, p.slot, aa);
        if (c > cover) cover = c;
      }
      const v = smoothstep(lo, hi, cover);
      data[row + x] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  }

  return {
    data, width, height,
    meta: {
      seed, template: layout.template, falloff: layout.falloff, marks,
      ringPitch: Number(layout.basePitch.toFixed(3)),
    },
  };
}
