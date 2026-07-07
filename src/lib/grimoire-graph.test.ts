// @ts-nocheck
import assert from "node:assert/strict";
const { buildDocGraph } = await import("./grimoire-graph.ts");

const index = {
  knowledge: [
    { id: "a", title: "Alpha" },
    { id: "b", title: "Beta" },
  ],
  memory: [{ path: "/root/notes.md" }],
  journal: [],
};

const docs = [
  // Alpha links Beta (by title), notes (memory basename), itself (dropped),
  // a ghost (unresolved, dropped), and Beta again (dup edge collapsed).
  { ref: { kind: "knowledge", id: "a" }, title: "Alpha", markdown: "[[Beta]] [[notes]] [[Alpha]] [[ghost]] [[Beta|again]]" },
  { ref: { kind: "knowledge", id: "b" }, title: "Beta", markdown: "back to [[Alpha]]" },
];

const g = buildDocGraph(docs, index);

// ── nodes: two sources + one memory leaf, deterministic id order ─────────────
assert.deepEqual(
  g.nodes.map((n) => n.id),
  ["knowledge:a", "knowledge:b", "memory:/root/notes.md"],
  "sources + a resolved memory leaf, stable-sorted by id",
);
assert.equal(g.nodes.find((n) => n.id === "memory:/root/notes.md").title, "notes", "leaf label is the link display text");
assert.equal(g.nodes.find((n) => n.id === "knowledge:a").kind, "knowledge", "node carries its kind");
for (const n of g.nodes) {
  assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), "every node has finite layout coordinates");
}

// ── edges: a→b, a→memory, b→a; no self-loop, no ghost, no dup ────────────────
const pairs = g.edges.map((e) => `${e.source}->${e.target}`).sort();
assert.deepEqual(
  pairs,
  ["knowledge:a->knowledge:b", "knowledge:a->memory:/root/notes.md", "knowledge:b->knowledge:a"].sort(),
  "resolved, de-duped, self-free edges",
);
assert.equal(g.edges.filter((e) => e.source === e.target).length, 0, "no self-loops");
assert.equal(g.edges.filter((e) => e.target.includes("ghost")).length, 0, "unresolved links produce no edge");

// ── degenerate cases ────────────────────────────────────────────────────────
assert.deepEqual(buildDocGraph([], index), { nodes: [], edges: [] }, "empty input → empty graph");
const solo = buildDocGraph([{ ref: { kind: "knowledge", id: "a" }, title: "Alpha", markdown: "no links" }], index);
assert.equal(solo.nodes.length, 1, "a doc with no links is a lone node");
assert.deepEqual({ x: solo.nodes[0].x, y: solo.nodes[0].y }, { x: 0, y: 0 }, "a single node sits at the origin");
assert.equal(solo.edges.length, 0, "no links → no edges");

console.log("grimoire-graph.test.ts: ok");
