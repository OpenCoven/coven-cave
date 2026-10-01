// @ts-nocheck
import assert from "node:assert/strict";
const {
  createForceSim,
  tickForceSim,
  settleForceSim,
  reheatForceSim,
  pinForceSimNode,
  unpinForceSimNode,
  spiralSeed,
  ALPHA_MIN,
  DEFAULT_FORCE_PARAMS,
} = await import("./grimoire-force.ts");

const nodes = [
  { id: "a", radius: 6 },
  { id: "b", radius: 6 },
  { id: "c", radius: 4 },
  { id: "d", radius: 4 },
];
// a—b linked; c and d are orphans.
const links = [{ source: "a", target: "b", strength: 1 }];

// The spring only reads as "pull together" once its rest length is shorter
// than the ambient repulsion spacing — with a 4-node test cloud that means a
// small linkDistance (real graphs have hundreds of nodes and far larger
// ambient spacing than the default 110).
const PARAMS = { ...DEFAULT_FORCE_PARAMS, linkDistance: 30 };

// ── determinism: no RNG anywhere, same input → identical layout ──────────────
const s1 = createForceSim(nodes, links);
const s2 = createForceSim(nodes, links);
settleForceSim(s1, PARAMS);
settleForceSim(s2, PARAMS);
assert.deepEqual([...s1.x], [...s2.x], "x positions are deterministic");
assert.deepEqual([...s1.y], [...s2.y], "y positions are deterministic");

// ── sanity: settled, finite, structured ──────────────────────────────────────
assert.ok(s1.alpha <= ALPHA_MIN, "the sim settles below ALPHA_MIN");
for (let i = 0; i < s1.count; i++) {
  assert.ok(Number.isFinite(s1.x[i]) && Number.isFinite(s1.y[i]), "positions stay finite");
}
const dist = (s, i, j) => Math.hypot(s.x[i] - s.x[j], s.y[i] - s.y[j]);
const [ia, ib, ic, id_] = ["a", "b", "c", "d"].map((k) => s1.indexOf.get(k));
assert.ok(
  dist(s1, ia, ib) < dist(s1, ic, id_),
  "a linked pair settles closer together than an unlinked pair",
);
assert.ok(dist(s1, ia, ib) > (6 + 6) / 2, "repulsion keeps linked nodes from collapsing onto each other");

// ── seeded positions are honored (layout continuity across rebuilds) ─────────
const seeded = createForceSim([{ id: "a", radius: 5, x: 123, y: -45 }, { id: "b", radius: 5 }], []);
assert.equal(seeded.x[0], 123, "an explicit seed x is used as-is");
assert.equal(seeded.y[0], -45, "an explicit seed y is used as-is");
const sp = spiralSeed(1);
assert.deepEqual({ x: seeded.x[1], y: seeded.y[1] }, sp, "unseeded nodes fall back to the spiral");

// ── links referencing missing nodes are dropped, not crashed on ──────────────
const filtered = createForceSim([{ id: "a", radius: 5 }], [{ source: "a", target: "ghost", strength: 1 }]);
assert.equal(filtered.links.s.length, 0, "an edge to a filtered-out node is dropped");

// ── pinning: a pinned node holds its exact position through ticks ────────────
const s3 = createForceSim(nodes, links);
pinForceSimNode(s3, 0, 50, 60);
for (let i = 0; i < 30; i++) tickForceSim(s3);
assert.equal(s3.x[0], 50, "a pinned node does not move (x)");
assert.equal(s3.y[0], 60, "a pinned node does not move (y)");
unpinForceSimNode(s3, 0);
reheatForceSim(s3);
assert.ok(s3.alpha >= 0.4, "reheat raises alpha");
for (let i = 0; i < 30; i++) tickForceSim(s3);
assert.ok(s3.x[0] !== 50 || s3.y[0] !== 60, "an unpinned node rejoins the simulation");

// ── coincident nodes split apart instead of dividing by zero ─────────────────
const s4 = createForceSim(
  [{ id: "a", radius: 5, x: 0, y: 0 }, { id: "b", radius: 5, x: 0, y: 0 }],
  [],
);
settleForceSim(s4);
assert.ok(dist(s4, 0, 1) > 1, "two nodes seeded on the same point separate");
assert.ok(Number.isFinite(s4.x[0]) && Number.isFinite(s4.x[1]), "…without NaN");

// ── degenerate inputs ────────────────────────────────────────────────────────
const empty = createForceSim([], []);
settleForceSim(empty);
assert.equal(empty.count, 0, "an empty sim is fine");
const single = createForceSim([{ id: "only", radius: 5 }], []);
settleForceSim(single);
assert.ok(Number.isFinite(single.x[0]), "a single node settles");

// ── params exist and are plausible ───────────────────────────────────────────
for (const k of ["repelStrength", "linkDistance", "linkStrength", "centerStrength"]) {
  assert.ok(DEFAULT_FORCE_PARAMS[k] > 0, `${k} has a positive default`);
}


// ── hubs stay bounded (the blank-Relations regression) ───────────────────────
// A real corpus had tag:research with 120 edges and tag:autoresearch with 98.
// Un-normalised springs summed per tick overshot further every tick and the
// layout diverged to ±1e100, so every node drew off-screen. Degree-normalised
// springs keep a hub's pull bounded at any degree, in 2D and in 3D.
for (const dims of [2, 3]) {
  const hubNodes = [{ id: "hub-a", radius: 4 }, { id: "hub-b", radius: 4 }];
  const hubLinks = [];
  for (let i = 0; i < 160; i++) {
    hubNodes.push({ id: `doc-${i}`, radius: 5 });
    if (i < 120) hubLinks.push({ source: `doc-${i}`, target: "hub-a", strength: 0.7, distanceScale: 0.85 });
    if (i >= 62) hubLinks.push({ source: `doc-${i}`, target: "hub-b", strength: 0.7, distanceScale: 0.85 });
  }
  const sim = createForceSim(hubNodes, hubLinks, { dims });
  for (let t = 0; t < 400; t++) tickForceSim(sim);
  let extent = 0;
  for (let i = 0; i < sim.count; i++) {
    assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]) && Number.isFinite(sim.z[i]), `${dims}D hub layout stays finite`);
    extent = Math.max(extent, Math.abs(sim.x[i]), Math.abs(sim.y[i]), Math.abs(sim.z[i]));
  }
  assert.ok(extent < 5000, `${dims}D hub layout stays on a screen-sized scale (extent ${extent.toFixed(0)})`);
  if (dims === 2) assert.ok([...sim.z].every((v) => v === 0), "a 2D sim never moves along z");
  else assert.ok([...sim.z].some((v) => Math.abs(v) > 1), "a 3D sim uses its depth axis");
}

// ── 3D sims are deterministic and honour seeded depth ────────────────────────
const t1 = createForceSim(nodes, links, { dims: 3 });
const t2 = createForceSim(nodes, links, { dims: 3 });
settleForceSim(t1, PARAMS);
settleForceSim(t2, PARAMS);
assert.deepEqual([...t1.z], [...t2.z], "3D z positions are deterministic");
const seeded3 = createForceSim([{ id: "a", radius: 5, x: 1, y: 2, z: 3 }], [], { dims: 3 });
assert.equal(seeded3.z[0], 3, "an explicit seed z is used as-is");

console.log("grimoire-force.test.ts: ok");
