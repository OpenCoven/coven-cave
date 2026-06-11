// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildMemoryGraphModel,
  buildMemoryGraphSceneModel,
  memorySelectionObjectKey,
  resolveMemoryFamiliarFilter,
} from "./memory-graph-3d-model.ts";

const familiars = [
  { id: "nova", display_name: "Nova", role: "Guide", icon: "ph:sparkle" },
  { id: "cody", display_name: "Cody", role: "Builder", emoji: "C" },
];

const covenEntries = [
  {
    id: "mem-1",
    familiar_id: "nova",
    title: "Nova remembers routing",
    path: "/Users/buns/.coven/memory/nova.md",
    updated_at: "2026-06-08T05:00:00.000Z",
    excerpt: "routing architecture",
    source_context: "session://nova-routing-2026-06-08",
  },
  {
    id: "mem-2",
    familiar_id: "cody",
    title: "Cody build note",
    path: "/Users/buns/.coven/memory/cody.md",
    updated_at: "2026-06-08T04:00:00.000Z",
  },
  {
    id: "mem-3",
    familiar_id: "nova",
    title: "Older Nova note",
    path: "/Users/buns/.coven/memory/nova-old.md",
    updated_at: "2026-06-07T04:00:00.000Z",
  },
];

const fileEntries = [
  {
    root: "workspace",
    rootLabel: "Workspace memory",
    relPath: "2026-06-08.md",
    fullPath: "/Users/buns/.openclaw/workspace/memory/2026-06-08.md",
    size: 1200,
    modified: "2026-06-08T05:10:00.000Z",
  },
];

const graph = buildMemoryGraphModel({
  familiars,
  covenEntries,
  fileEntries,
  query: "",
  familiarFilter: "nova",
  maxLeavesPerHub: 1,
  includeSources: false, // legacy agent-only focus (b0df474) stays available
});

const familiarHubs = graph.nodes.filter((node) => node.kind === "hub" && node.hubKind === "familiar");
assert.deepEqual(
  familiarHubs.map((node) => node.id),
  ["familiar:nova"],
  "memory graph should render one selected familiar hub instead of a cross-agent constellation",
);

assert.equal(
  graph.nodes.some((node) => node.kind === "hub" && node.hubKind === "files"),
  false,
  "agent-level memory graph should not render a global Memory Files hub",
);

assert.ok(
  graph.edges.some((edge) => edge.source === "memory:coven:mem-1" && edge.target === "familiar:nova"),
  "coven memory leaves should connect to their familiar hub",
);

assert.equal(
  graph.nodes.some((node) => node.kind === "memory" && node.source === "file"),
  false,
  "agent-level memory graph should not render filesystem leaves",
);

assert.equal(
  graph.nodes.find((node) => node.kind === "cluster" && node.hubId === "familiar:nova")?.count,
  1,
  "overflow familiar memories should collapse into a cluster node",
);

const filtered = buildMemoryGraphModel({
  familiars,
  covenEntries,
  fileEntries,
  query: "routing",
  familiarFilter: "nova",
  maxLeavesPerHub: 10,
});

assert.deepEqual(
  filtered.nodes.filter((node) => node.kind === "memory" && node.source === "coven").map((node) => node.id),
  ["memory:coven:mem-1"],
  "query and familiar filters should apply to familiar memory leaves",
);

assert.equal(
  filtered.nodes.find((node) => node.id === "memory:coven:mem-1")?.sourceContext,
  "session://nova-routing-2026-06-08",
  "coven memory nodes should preserve source_context as sourceContext provenance",
);

const provenanceFiltered = buildMemoryGraphModel({
  familiars,
  covenEntries,
  fileEntries,
  query: "session://nova-routing",
  familiarFilter: "nova",
  maxLeavesPerHub: 10,
});

assert.deepEqual(
  provenanceFiltered.nodes.filter((node) => node.kind === "memory").map((node) => node.id),
  ["memory:coven:mem-1"],
  "memory graph search should match source_context provenance URIs",
);

assert.equal(
  memorySelectionObjectKey({ kind: "familiar", id: "nova" }),
  "hub:familiar:nova",
);
assert.equal(
  memorySelectionObjectKey({ kind: "memory", id: "memory:coven:mem-1" }),
  "memory:memory:coven:mem-1",
);

const scene = buildMemoryGraphSceneModel(graph);
const novaHub = scene.nodes.find((node) => node.id === "familiar:nova");
const novaLeaf = scene.nodes.find((node) => node.id === "memory:coven:mem-1");
assert.ok(novaHub, "scene model should include familiar hub positions");
assert.ok(novaLeaf, "scene model should include memory leaf positions");
assert.notDeepEqual(
  novaHub?.position,
  novaLeaf?.position,
  "memory leaves should be positioned in a focused agent-level field, not on top of the hub",
);
assert.equal(
  scene.nodes.find((node) => node.id === "familiar:nova")?.memoryCount,
  2,
  "hub memory count should reflect total matching entries before visual leaf caps",
);
assert.ok(
  Math.min(...scene.nodes.filter((node) => node.kind !== "hub").map((node) => node.position.x)) > (novaHub?.position.x ?? 0),
  "memory cards should fan forward from the selected familiar instead of orbiting around multiple agents",
);

assert.equal(
  resolveMemoryFamiliarFilter({
    familiars: [
      { id: "empty", display_name: "Empty", role: "Quiet" },
      ...familiars,
    ],
    covenEntries,
    currentFamiliarId: "empty",
    activeFamiliarId: null,
  }),
  "nova",
  "initial memory selection should prefer a familiar with memory over a blank default familiar",
);

assert.equal(
  resolveMemoryFamiliarFilter({
    familiars: [
      { id: "empty", display_name: "Empty", role: "Quiet" },
      ...familiars,
    ],
    covenEntries,
    currentFamiliarId: "empty",
    activeFamiliarId: "empty",
  }),
  "empty",
  "explicit active familiar selection should be preserved even when that familiar has no memory",
);

const denseEntries = Array.from({ length: 96 }, (_, index) => ({
  id: `dense-${index}`,
  familiar_id: "nova",
  title: `Dense memory ${index}`,
  path: `/Users/buns/.coven/memory/nova/dense-${index}.md`,
  updated_at: `2026-06-08T05:${String(59 - (index % 60)).padStart(2, "0")}:00.000Z`,
}));

const denseGraph = buildMemoryGraphModel({
  familiars,
  covenEntries: denseEntries,
  fileEntries,
  query: "",
  familiarFilter: "nova",
  maxLeavesPerHub: 24,
});
const denseScene = buildMemoryGraphSceneModel(denseGraph);
const denseCardY = denseScene.nodes.filter((node) => node.kind === "memory").map((node) => node.position.y);

assert.equal(
  denseGraph.nodes.filter((node) => node.kind === "memory" && node.hubId === "familiar:nova").length,
  24,
  "dense memory maps should cluster before the card field exceeds the initial camera framing",
);
assert.equal(
  denseGraph.nodes.find((node) => node.kind === "cluster")?.count,
  72,
  "dense memory maps should expose older entries as a stack when cards are capped",
);
assert.ok(
  Math.max(...denseCardY) <= 3,
  "dense memory card fields should stay within the first-frame vertical framing",
);

// ── Source-level memories (no familiarId) must appear as their own hubs ──
// ~/.coven/memory, OpenClaw workspace/index, and Codex runtime entries carry
// no familiarId; the graph previously dropped them silently.
const sourceFileEntries = [
  ...fileEntries, // "workspace" root, unscoped
  {
    root: "coven-origin",
    rootLabel: "Coven native memory",
    relPath: "shared-canon.md",
    fullPath: "/Users/buns/.coven/memory/shared-canon.md",
    size: 800,
    modified: "2026-06-08T06:00:00.000Z",
  },
  {
    root: "coven-origin",
    rootLabel: "Coven native memory",
    relPath: "older-note.md",
    fullPath: "/Users/buns/.coven/memory/older-note.md",
    size: 400,
    modified: "2026-06-07T06:00:00.000Z",
  },
  {
    root: "openclaw-familiar",
    rootLabel: "Nova workspace",
    relPath: "MEMORY.md",
    fullPath: "/Users/buns/.openclaw/workspace/nova/MEMORY.md",
    size: 300,
    modified: "2026-06-08T03:00:00.000Z",
    familiarId: "nova",
  },
];

const sourceGraph = buildMemoryGraphModel({
  familiars,
  covenEntries,
  fileEntries: sourceFileEntries,
  query: "",
  familiarFilter: "nova",
  maxLeavesPerHub: 1,
});

const sourceHubs = sourceGraph.nodes.filter(
  (node) => node.kind === "hub" && node.hubKind === "source",
);
assert.equal(sourceHubs.length, 2, "each unscoped memory root becomes a source hub (workspace + coven-origin)");
assert.ok(
  sourceHubs.some((hub) => hub.label === "Coven native memory"),
  "source hubs are labeled by their memory source",
);

const sourceLeafIds = sourceGraph.nodes
  .filter((node) => node.kind === "memory" && node.hubId.startsWith("source:"))
  .map((node) => node.id);
assert.ok(
  sourceLeafIds.includes("file:/Users/buns/.coven/memory/shared-canon.md"),
  "unscoped source memories render as leaves under their source hub",
);
assert.ok(
  !sourceGraph.nodes.some((node) => node.kind === "memory" && node.id === "file:/Users/buns/.openclaw/workspace/nova/MEMORY.md" && node.hubId.startsWith("source:")),
  "familiar-scoped entries stay under the familiar, not a source hub",
);

// Capping applies per source hub and surfaces a cluster
const covenOriginCluster = sourceGraph.nodes.find(
  (node) => node.kind === "cluster" && node.hubId === "source:coven-origin",
);
assert.equal(covenOriginCluster?.count, 1, "older source memories collapse into a cluster per hub");

assert.equal(sourceGraph.metrics.sourceHubs, 2, "metrics expose the source hub count");

// Scene: hubs must not overlap when source hubs join the familiar constellation
const sourceScene = buildMemoryGraphSceneModel(sourceGraph);
const hubPositions = sourceScene.nodes
  .filter((node) => node.kind === "hub")
  .map((node) => `${node.position.x},${node.position.y},${node.position.z}`);
assert.equal(new Set(hubPositions).size, hubPositions.length, "every hub gets a distinct scene position");

// Query filtering still applies to source memories
const filteredSourceGraph = buildMemoryGraphModel({
  familiars,
  covenEntries,
  fileEntries: sourceFileEntries,
  query: "shared-canon",
  familiarFilter: "nova",
  maxLeavesPerHub: 8,
});
assert.ok(
  filteredSourceGraph.nodes.some((node) => node.kind === "memory" && node.title === "shared-canon.md"),
  "query matches source memory relPath",
);
assert.ok(
  !filteredSourceGraph.nodes.some((node) => node.kind === "hub" && node.id === "source:workspace"),
  "source hubs with no query matches drop out",
);

console.log("memory-graph-3d-model.test.ts: source-hub assertions ok");
