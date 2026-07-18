// A small deterministic force-directed layout for the Grimoire graph
// (cave-hand). Hand-rolled instead of pulling in d3-force: the graph renderer
// needs pin/drag, live-tunable params, and synchronous settling for reduced
// motion — ~150 lines of typed-array physics covers all of it with zero deps
// and no RNG (initial placement is a golden-angle spiral), so identical input
// always lays out identically.
//
// Model (d3-style alpha cooling):
//   repulsion  — every pair pushes apart with k/d² (capped at close range)
//   springs    — every edge pulls toward its rest length
//   centering  — everything drifts gently toward the origin
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
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  radius: Float64Array;
  pinned: Uint8Array;
  alpha: number;
  indexOf: ReadonlyMap<string, number>;
  links: { s: Int32Array; t: Int32Array; strength: Float64Array; distanceScale: Float64Array };
};

export const ALPHA_MIN = 0.015;
const ALPHA_DECAY = 0.028;
const VELOCITY_DECAY = 0.55;
// Golden angle in radians — spiral seeding spreads nodes evenly with no RNG.
const GOLDEN_ANGLE = 2.399963229728653;

/** Deterministic spiral seed for node `i` of a sim (also used by callers to
 *  place nodes that appear after the initial build). */
export function spiralSeed(i: number, spread = 26): { x: number; y: number } {
  const r = spread * Math.sqrt(i + 0.5);
  return { x: r * Math.cos(i * GOLDEN_ANGLE), y: r * Math.sin(i * GOLDEN_ANGLE) };
}

export function createForceSim(
  nodes: readonly ForceSimNode[],
  links: readonly ForceSimLink[],
): ForceSim {
  const count = nodes.length;
  const ids = nodes.map((n) => n.id);
  const indexOf = new Map<string, number>();
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const radius = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const n = nodes[i];
    indexOf.set(n.id, i);
    const seed = spiralSeed(i);
    x[i] = Number.isFinite(n.x) ? (n.x as number) : seed.x;
    y[i] = Number.isFinite(n.y) ? (n.y as number) : seed.y;
    radius[i] = n.radius;
  }

  // Only links whose endpoints exist survive (filters can drop nodes).
  const live = links.filter((l) => indexOf.has(l.source) && indexOf.has(l.target));
  const s = new Int32Array(live.length);
  const t = new Int32Array(live.length);
  const strength = new Float64Array(live.length);
  const distanceScale = new Float64Array(live.length);
  for (let i = 0; i < live.length; i++) {
    s[i] = indexOf.get(live[i].source) as number;
    t[i] = indexOf.get(live[i].target) as number;
    strength[i] = live[i].strength;
    distanceScale[i] = live[i].distanceScale ?? 1;
  }

  return {
    ids,
    count,
    x,
    y,
    vx: new Float64Array(count),
    vy: new Float64Array(count),
    radius,
    pinned: new Uint8Array(count),
    alpha: 1,
    indexOf,
    links: { s, t, strength, distanceScale },
  };
}

/** Advance the simulation one step. Returns the post-tick alpha. */
export function tickForceSim(sim: ForceSim, params: ForceParams = DEFAULT_FORCE_PARAMS): number {
  const { count, x, y, vx, vy, radius, pinned, links } = sim;
  const alpha = sim.alpha;

  // Repulsion — symmetric O(n²/2) with a coincidence guard so two nodes on the
  // exact same point split apart deterministically instead of dividing by zero.
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      let dx = x[j] - x[i];
      let dy = y[j] - y[i];
      let d2 = dx * dx + dy * dy;
      if (d2 < 1e-6) {
        dx = 0.01 * ((i % 7) - 3 + 0.5);
        dy = 0.01 * ((j % 5) - 2 + 0.5);
        d2 = dx * dx + dy * dy;
      }
      // Cap the force once nodes are visually touching so tight clusters
      // relax instead of exploding.
      const touch = radius[i] + radius[j] + 2;
      const eff = Math.max(d2, touch * touch * 0.25);
      const f = (params.repelStrength * alpha) / eff;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      vx[i] -= fx;
      vy[i] -= fy;
      vx[j] += fx;
      vy[j] += fy;
    }
  }

  // Springs along edges.
  for (let e = 0; e < links.s.length; e++) {
    const a = links.s[e];
    const b = links.t[e];
    let dx = x[b] - x[a];
    let dy = y[b] - y[a];
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-3) {
      dx = 0.01;
      dy = 0.01;
      d = Math.SQRT2 * 0.01;
    }
    const rest = params.linkDistance * links.distanceScale[e];
    const f = links.strength[e] * params.linkStrength * alpha * ((d - rest) / d);
    const fx = dx * f;
    const fy = dy * f;
    vx[a] += fx;
    vy[a] += fy;
    vx[b] -= fx;
    vy[b] -= fy;
  }

  // Centering + integration.
  for (let i = 0; i < count; i++) {
    if (pinned[i]) {
      vx[i] = 0;
      vy[i] = 0;
      continue;
    }
    vx[i] = (vx[i] - x[i] * params.centerStrength * alpha) * VELOCITY_DECAY;
    vy[i] = (vy[i] - y[i] * params.centerStrength * alpha) * VELOCITY_DECAY;
    x[i] += vx[i];
    y[i] += vy[i];
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
 *  but doesn't move until unpinned. */
export function pinForceSimNode(sim: ForceSim, index: number, px: number, py: number): void {
  sim.pinned[index] = 1;
  sim.x[index] = px;
  sim.y[index] = py;
  sim.vx[index] = 0;
  sim.vy[index] = 0;
}

export function unpinForceSimNode(sim: ForceSim, index: number): void {
  sim.pinned[index] = 0;
}
