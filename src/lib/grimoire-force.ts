// A small deterministic force-directed layout for the Grimoire graph
// (cave-hand). Hand-rolled instead of pulling in d3-force: the graph renderer
// needs pin/drag, live-tunable params, and synchronous settling for reduced
// motion — ~150 lines of typed-array physics covers all of it with zero deps
// and no RNG (initial placement is a golden-angle spiral), so identical input
// always lays out identically.
//
// Model (d3-style alpha cooling):
//   repulsion  — every pair pushes apart with k/d² (capped at close range)
//   springs    — every edge pulls toward its rest length, its stiffness divided
//                by the smaller endpoint degree and its correction split by
//                degree (d3-force's link model). Without that a hub with 120
//                tag edges summed 120 un-normalised springs per tick, every
//                tick overshot further than the last, and the layout diverged
//                to ±1e100 — the Relations graph drew nothing on screen.
//   centering  — everything drifts gently toward the origin
// The same physics runs in 2D or 3D (`dims`); 3D adds a z axis that the
// Relations view projects with a perspective camera. Speeds are capped and any
// non-finite coordinate is reset, so no input can blow the layout up.
// Forces scale by `alpha`, which decays each tick; the sim is "settled" once
// alpha crosses ALPHA_MIN. Dragging pins a node (velocity ignored) and reheats.

export type ForceParams = {
  /** Pair repulsion constant — higher spreads the graph out. */
  repelStrength: number;
  /** Spring rest length for link edges (mention/tag edges ride multipliers). */
  linkDistance: number;
  /** Spring stiffness baseline, scaled per-edge by its `strength`. */
  linkStrength: number;
  /** Pull toward the origin — keeps disconnected components on screen. */
  centerStrength: number;
};

export const DEFAULT_FORCE_PARAMS: ForceParams = {
  repelStrength: 900,
  linkDistance: 110,
  linkStrength: 0.5,
  centerStrength: 0.012,
};

export type ForceSimNode = {
  id: string;
  /** Visual radius — close-range repulsion caps at touching distance. */
  radius: number;
  /** Seed position (e.g. carried over from a previous sim); spiral otherwise. */
  x?: number;
  y?: number;
  z?: number;
};

export type ForceSimLink = {
  source: string;
  target: string;
  /** Relative spring strength (link 1, tag ~0.7, mention ~0.4). */
  strength: number;
  /** Rest-length multiplier on ForceParams.linkDistance (default 1). */
  distanceScale?: number;
};

export type ForceSim = {
  ids: readonly string[];
  count: number;
  /** 2 for the flat layout, 3 for the volumetric one (z stays 0 in 2D). */
  dims: 2 | 3;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  radius: Float64Array;
  pinned: Uint8Array;
  alpha: number;
  indexOf: ReadonlyMap<string, number>;
  links: {
    s: Int32Array;
    t: Int32Array;
    strength: Float64Array;
    distanceScale: Float64Array;
    /** Share of a spring's correction applied to the target (d3's bias). */
    bias: Float64Array;
  };
};

export const ALPHA_MIN = 0.015;
const ALPHA_DECAY = 0.028;
const VELOCITY_DECAY = 0.55;
/** Per-tick speed cap in world units — a backstop, not part of the model. */
const MAX_SPEED = 60;
// Golden angle in radians — spiral seeding spreads nodes evenly with no RNG.
const GOLDEN_ANGLE = 2.399963229728653;

/** Deterministic spiral seed for node `i` of a sim (also used by callers to
 *  place nodes that appear after the initial build). */
export function spiralSeed(i: number, spread = 26): { x: number; y: number } {
  const r = spread * Math.sqrt(i + 0.5);
  return { x: r * Math.cos(i * GOLDEN_ANGLE), y: r * Math.sin(i * GOLDEN_ANGLE) };
}

/** Deterministic 3D seed: a golden-angle spiral wrapped around a sphere whose
 *  radius grows with the cube root of the index, so the cloud fills a ball
 *  evenly instead of a shell. */
export function sphereSeed(i: number, spread = 26): { x: number; y: number; z: number } {
  const r = spread * 1.6 * Math.cbrt(i + 0.5);
  // Fibonacci-sphere latitude from a low-discrepancy sequence on the index.
  const u = ((i * 0.6180339887498949) % 1) * 2 - 1;
  const ring = Math.sqrt(Math.max(0, 1 - u * u));
  const theta = i * GOLDEN_ANGLE;
  return { x: r * ring * Math.cos(theta), y: r * u, z: r * ring * Math.sin(theta) };
}

export function createForceSim(
  nodes: readonly ForceSimNode[],
  links: readonly ForceSimLink[],
  options: { dims?: 2 | 3 } = {},
): ForceSim {
  const dims = options.dims ?? 2;
  const count = nodes.length;
  const ids = nodes.map((n) => n.id);
  const indexOf = new Map<string, number>();
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const z = new Float64Array(count);
  const radius = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const n = nodes[i];
    indexOf.set(n.id, i);
    if (dims === 3) {
      const seed = sphereSeed(i);
      x[i] = Number.isFinite(n.x) ? (n.x as number) : seed.x;
      y[i] = Number.isFinite(n.y) ? (n.y as number) : seed.y;
      z[i] = Number.isFinite(n.z) ? (n.z as number) : seed.z;
    } else {
      const seed = spiralSeed(i);
      x[i] = Number.isFinite(n.x) ? (n.x as number) : seed.x;
      y[i] = Number.isFinite(n.y) ? (n.y as number) : seed.y;
    }
    radius[i] = n.radius;
  }

  // Only links whose endpoints exist survive (filters can drop nodes).
  const live = links.filter(
    (l) => l.source !== l.target && indexOf.has(l.source) && indexOf.has(l.target),
  );
  const degree = new Float64Array(count);
  for (const l of live) {
    degree[indexOf.get(l.source) as number]++;
    degree[indexOf.get(l.target) as number]++;
  }
  const s = new Int32Array(live.length);
  const t = new Int32Array(live.length);
  const strength = new Float64Array(live.length);
  const distanceScale = new Float64Array(live.length);
  const bias = new Float64Array(live.length);
  for (let i = 0; i < live.length; i++) {
    const a = indexOf.get(live[i].source) as number;
    const b = indexOf.get(live[i].target) as number;
    s[i] = a;
    t[i] = b;
    // Normalise by the lighter endpoint so a hub's springs sum to a bounded
    // pull instead of one full-strength spring per edge.
    strength[i] = live[i].strength / Math.min(degree[a], degree[b]);
    distanceScale[i] = live[i].distanceScale ?? 1;
    bias[i] = degree[a] / (degree[a] + degree[b]);
  }

  return {
    ids,
    count,
    dims,
    x,
    y,
    z,
    vx: new Float64Array(count),
    vy: new Float64Array(count),
    vz: new Float64Array(count),
    radius,
    pinned: new Uint8Array(count),
    alpha: 1,
    indexOf,
    links: { s, t, strength, distanceScale, bias },
  };
}

/** Advance the simulation one step. Returns the post-tick alpha. */
export function tickForceSim(sim: ForceSim, params: ForceParams = DEFAULT_FORCE_PARAMS): number {
  const { count, x, y, z, vx, vy, vz, radius, pinned, links } = sim;
  const three = sim.dims === 3;
  const alpha = sim.alpha;

  // Repulsion — symmetric O(n²/2) with a coincidence guard so two nodes on the
  // exact same point split apart deterministically instead of dividing by zero.
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      let dx = x[j] - x[i];
      let dy = y[j] - y[i];
      let dz = three ? z[j] - z[i] : 0;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-6) {
        dx = 0.01 * ((i % 7) - 3 + 0.5);
        dy = 0.01 * ((j % 5) - 2 + 0.5);
        dz = three ? 0.01 * (((i + j) % 3) - 1 + 0.5) : 0;
        d2 = dx * dx + dy * dy + dz * dz;
      }
      // Cap the force once nodes are visually touching so tight clusters
      // relax instead of exploding.
      const touch = radius[i] + radius[j] + 2;
      const eff = Math.max(d2, touch * touch * 0.25);
      const f = (params.repelStrength * alpha) / eff;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      const fz = (dz / d) * f;
      vx[i] -= fx;
      vy[i] -= fy;
      vx[j] += fx;
      vy[j] += fy;
      if (three) {
        vz[i] -= fz;
        vz[j] += fz;
      }
    }
  }

  // Springs along edges (degree-normalised; see the header).
  for (let e = 0; e < links.s.length; e++) {
    const a = links.s[e];
    const b = links.t[e];
    let dx = x[b] + vx[b] - x[a] - vx[a];
    let dy = y[b] + vy[b] - y[a] - vy[a];
    let dz = three ? z[b] + vz[b] - z[a] - vz[a] : 0;
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-3) {
      dx = 0.01;
      dy = 0.01;
      dz = three ? 0.01 : 0;
      d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const rest = params.linkDistance * links.distanceScale[e];
    const l = ((d - rest) / d) * alpha * links.strength[e] * params.linkStrength;
    const fx = dx * l;
    const fy = dy * l;
    const fz = dz * l;
    const bias = links.bias[e];
    vx[b] -= fx * bias;
    vy[b] -= fy * bias;
    vx[a] += fx * (1 - bias);
    vy[a] += fy * (1 - bias);
    if (three) {
      vz[b] -= fz * bias;
      vz[a] += fz * (1 - bias);
    }
  }

  // Centering + integration.
  for (let i = 0; i < count; i++) {
    if (pinned[i]) {
      vx[i] = 0;
      vy[i] = 0;
      vz[i] = 0;
      continue;
    }
    let nvx = (vx[i] - x[i] * params.centerStrength * alpha) * VELOCITY_DECAY;
    let nvy = (vy[i] - y[i] * params.centerStrength * alpha) * VELOCITY_DECAY;
    let nvz = three ? (vz[i] - z[i] * params.centerStrength * alpha) * VELOCITY_DECAY : 0;
    const speed = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz);
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed;
      nvx *= scale;
      nvy *= scale;
      nvz *= scale;
    }
    vx[i] = nvx;
    vy[i] = nvy;
    vz[i] = nvz;
    x[i] += nvx;
    y[i] += nvy;
    if (three) z[i] += nvz;
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]) || !Number.isFinite(z[i])) {
      const seed = three ? sphereSeed(i) : { ...spiralSeed(i), z: 0 };
      x[i] = seed.x;
      y[i] = seed.y;
      z[i] = seed.z;
      vx[i] = 0;
      vy[i] = 0;
      vz[i] = 0;
    }
  }

  sim.alpha = Math.max(0, alpha - alpha * ALPHA_DECAY);
  return sim.alpha;
}

/** Run the sim to rest (alpha below ALPHA_MIN), bounded by `maxTicks`. Used
 *  for reduced-motion (settle synchronously, render once) and for tests. */
export function settleForceSim(
  sim: ForceSim,
  params: ForceParams = DEFAULT_FORCE_PARAMS,
  maxTicks = 400,
): void {
  let ticks = 0;
  while (sim.alpha > ALPHA_MIN && ticks < maxTicks) {
    tickForceSim(sim, params);
    ticks++;
  }
}

/** Reheat after a perturbation (drag, param change) so motion resumes. */
export function reheatForceSim(sim: ForceSim, alpha = 0.4): void {
  sim.alpha = Math.max(sim.alpha, alpha);
}

/** Pin a node to a position (dragging). A pinned node exerts forces on others
 *  but doesn't move until unpinned. `pz` keeps its depth when omitted. */
export function pinForceSimNode(sim: ForceSim, index: number, px: number, py: number, pz?: number): void {
  sim.pinned[index] = 1;
  sim.x[index] = px;
  sim.y[index] = py;
  if (pz !== undefined && sim.dims === 3) sim.z[index] = pz;
  sim.vx[index] = 0;
  sim.vy[index] = 0;
  sim.vz[index] = 0;
}

export function unpinForceSimNode(sim: ForceSim, index: number): void {
  sim.pinned[index] = 0;
}
