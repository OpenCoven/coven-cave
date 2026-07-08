// @ts-nocheck
import assert from "node:assert/strict";
const { buildDocGraph } = await import("./grimoire-graph.ts");

const index = {
  knowledge: [
    { id: "a", title: "Alpha" },
    { id: "b", title: "Beta" },
  ],
  memory: [{ path: "/root/notes.md" }],
  journal: [{ date: "2026-07-08" }],
};

const docs = [
  // Alpha links Beta (by title), notes (memory basename), itself (dropped),
  // a ghost (unresolved, dropped), and Beta again (dup edge collapsed).
  {
    ref: { kind: "knowledge", id: "a" },
    title: "Alpha",
    tags: ["Research", "research", " "],
    markdown: "[[Beta]] [[notes]] [[Alpha]] [[ghost]] [[Beta|again]]",
  },
  { ref: { kind: "knowledge", id: "b" }, title: "Beta", markdown: "back to [[Alpha]]", tags: ["research"] },
];

const g = buildDocGraph(docs, index);

// ── nodes: two sources + one memory leaf + one tag node, stable id order ─────
assert.deepEqual(
  g.nodes.map((n) => n.id),
  ["knowledge:a", "knowledge:b", "memory:/root/notes.md", "tag:research"],
  "sources + a resolved memory leaf + a normalized tag node, stable-sorted by id",
);
assert.equal(g.nodes.find((n) => n.id === "memory:/root/notes.md").title, "notes", "leaf label is the link display text");
assert.equal(g.nodes.find((n) => n.id === "knowledge:a").kind, "knowledge", "node carries its kind");
assert.equal(g.nodes.find((n) => n.id === "tag:research").kind, "tag", "tag nodes carry the tag kind");
assert.equal(g.nodes.find((n) => n.id === "tag:research").title, "#research", "tag nodes display as #tag");
assert.equal(g.nodes.find((n) => n.id === "tag:research").ref, null, "tag nodes have no doc to open");

// ── link edges: a→b, a→memory, b→a; no self-loop, no ghost, no dup ───────────
const linkPairs = g.edges.filter((e) => e.type === "link").map((e) => `${e.source}->${e.target}`).sort();
assert.deepEqual(
  linkPairs,
  ["knowledge:a->knowledge:b", "knowledge:a->memory:/root/notes.md", "knowledge:b->knowledge:a"].sort(),
  "resolved, de-duped, self-free link edges",
);
assert.equal(g.edges.filter((e) => e.source === e.target).length, 0, "no self-loops");
assert.equal(g.edges.filter((e) => e.target.includes("ghost")).length, 0, "unresolved links produce no edge");

// ── tag edges: both docs → tag:research, case-normalized, blanks dropped ─────
const tagPairs = g.edges.filter((e) => e.type === "tag").map((e) => `${e.source}->${e.target}`).sort();
assert.deepEqual(
  tagPairs,
  ["knowledge:a->tag:research", "knowledge:b->tag:research"],
  "tags normalize (case, trim) and connect each tagged doc once",
);

// ── degree: counts distinct touching edges ────────────────────────────────────
// a: link a→b, a→mem, b→a, tag → 4. tag:research: two tag edges → 2.
assert.equal(g.nodes.find((n) => n.id === "knowledge:a").degree, 4, "degree counts every touching edge");
assert.equal(g.nodes.find((n) => n.id === "tag:research").degree, 2, "tag nodes accumulate degree");

// ── mention edges: unlinked title occurrences, never duplicating a link ──────
const mentionDocs = [
  { ref: { kind: "knowledge", id: "a" }, title: "Alpha", markdown: "Beta shipped; see 2026-07-08 for notes. alphabet ≠ me." },
  { ref: { kind: "knowledge", id: "b" }, title: "Beta", markdown: "[[Alpha]] explicit — Alpha again in prose." },
  { ref: { kind: "journal", date: "2026-07-08" }, title: "2026-07-08", markdown: "wrote about beta" },
];
const mg = buildDocGraph(mentionDocs, index);
const mentions = mg.edges.filter((e) => e.type === "mention").map((e) => `${e.source}->${e.target}`).sort();
// a↔b is already connected by b's [[Alpha]] link, so a's prose "Beta" adds no
// mention edge — a linked pair never gains a mention in either direction.
assert.deepEqual(
  mentions,
  ["knowledge:a->journal:2026-07-08", "journal:2026-07-08->knowledge:b"].sort(),
  "prose mentions of titles and journal dates become mention edges (case-insensitive), except across already-linked pairs",
);
assert.ok(
  !mentions.includes("knowledge:b->knowledge:a") && !mentions.includes("knowledge:a->knowledge:b"),
  "a mention never restates an existing link edge for the same pair, either direction",
);
assert.equal(
  mg.edges.filter((e) => e.type === "mention" && e.source === "knowledge:a" && e.target === "knowledge:a").length,
  0,
  "no self-mentions",
);
// "alphabet" must not match "Alpha" — word-ish boundaries.
assert.equal(
  mg.edges.filter((e) => e.target === "knowledge:a" && e.type === "mention").length,
  0,
  "mentions respect word boundaries (alphabet ≠ Alpha)",
);

// ── wiki-link spans don't double as mentions ─────────────────────────────────
const masked = buildDocGraph(
  [
    { ref: { kind: "knowledge", id: "a" }, title: "Alpha", markdown: "only [[Beta]] here" },
    { ref: { kind: "knowledge", id: "b" }, title: "Beta", markdown: "" },
  ],
  index,
);
assert.equal(masked.edges.filter((e) => e.type === "mention").length, 0, "text inside [[...]] is not a mention");
assert.equal(masked.edges.filter((e) => e.type === "link").length, 1, "…but the link edge is there");

// ── options: mentions/tags are independently switchable ─────────────────────
const bare = buildDocGraph(mentionDocs, index, { mentions: false, tags: false });
assert.equal(bare.edges.filter((e) => e.type === "mention").length, 0, "mentions:false drops mention edges");
assert.equal(bare.nodes.filter((n) => n.kind === "tag").length, 0, "tags:false drops tag nodes");

// ── enforced generation: orphans are still nodes ─────────────────────────────
const solo = buildDocGraph(
  [{ ref: { kind: "knowledge", id: "a" }, title: "Alpha", markdown: "no links at all" }],
  index,
);
assert.equal(solo.nodes.length, 1, "a doc with no links is still a node (orphans enforced)");
assert.equal(solo.nodes[0].degree, 0, "an orphan has degree 0");
assert.equal(solo.edges.length, 0, "no links → no edges");
assert.deepEqual(buildDocGraph([], index), { nodes: [], edges: [] }, "empty input → empty graph");

// ── noise control: only discriminative needles infer mentions ────────────────
// A title owned by many docs is ambiguous (which one is meant?); a needle that
// fires from many docs is ordinary prose. Neither produces mention edges.
{
  const idx = { knowledge: [], memory: [], journal: [] };
  // 4 memory docs all titled "MEMORY" (owners > cap) + one doc mentioning it.
  const ambiguous = [
    ...[1, 2, 3, 4].map((i) => ({
      ref: { kind: "memory", path: `/r${i}/MEMORY.md` },
      title: "MEMORY",
      markdown: "",
    })),
    { ref: { kind: "knowledge", id: "z" }, title: "Zeta", markdown: "see MEMORY for details" },
  ];
  const ag = buildDocGraph(ambiguous, idx);
  assert.equal(
    ag.edges.filter((e) => e.type === "mention").length,
    0,
    "a needle owned by many docs is ambiguous — no mention edges",
  );

  // One doc titled "Phase" mentioned from 11 docs (fan-out > cap).
  const ubiquitous = [
    { ref: { kind: "knowledge", id: "p" }, title: "Phase", markdown: "" },
    ...Array.from({ length: 11 }, (_, i) => ({
      ref: { kind: "knowledge", id: `s${i}` },
      title: `Doc number ${i}`,
      markdown: "entering the next phase now",
    })),
  ];
  const ug = buildDocGraph(ubiquitous, idx);
  assert.equal(
    ug.edges.filter((e) => e.type === "mention").length,
    0,
    "a needle most docs use is prose, not a reference — no mention edges",
  );

  // …but the same shape under the cap still infers.
  const modest = [
    { ref: { kind: "knowledge", id: "p" }, title: "Phase", markdown: "" },
    ...Array.from({ length: 3 }, (_, i) => ({
      ref: { kind: "knowledge", id: `s${i}` },
      title: `Doc number ${i}`,
      markdown: "entering the next phase now",
    })),
  ];
  const mgm = buildDocGraph(modest, idx);
  assert.equal(
    mgm.edges.filter((e) => e.type === "mention").length,
    3,
    "under the fan-out cap, mentions infer normally",
  );
}

// ── regex-hostile titles don't break the mention scanner ────────────────────
const hostile = buildDocGraph(
  [
    { ref: { kind: "knowledge", id: "c" }, title: "C++ (notes)", markdown: "" },
    { ref: { kind: "knowledge", id: "d" }, title: "Dee", markdown: "learning C++ (notes) today" },
  ],
  { knowledge: [{ id: "c", title: "C++ (notes)" }, { id: "d", title: "Dee" }], memory: [], journal: [] },
);
assert.equal(
  hostile.edges.filter((e) => e.type === "mention" && e.target === "knowledge:c").length,
  1,
  "titles with regex metacharacters are escaped and still matchable",
);

console.log("grimoire-graph.test.ts: ok");
