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

console.log("grimoire-force.test.ts: ok");
