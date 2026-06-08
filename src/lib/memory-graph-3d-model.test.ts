// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildMemoryGraphModel,
  buildMemoryGraphSceneModel,
  memorySelectionObjectKey,
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
  familiarFilter: "all",
  maxLeavesPerHub: 1,
});

const familiarHubs = graph.nodes.filter((node) => node.kind === "hub" && node.hubKind === "familiar");
assert.deepEqual(
  familiarHubs.map((node) => node.id),
  ["familiar:nova", "familiar:cody"],
  "all familiar hubs should render even when their visible memory leaf count is capped",
);

assert.ok(
  graph.nodes.some((node) => node.kind === "hub" && node.hubKind === "files" && node.label === "Memory Files"),
  "filesystem memory entries should be represented under a neutral Memory Files hub",
);

assert.ok(
  graph.edges.some((edge) => edge.source === "memory:coven:mem-1" && edge.target === "familiar:nova"),
  "coven memory leaves should connect to their familiar hub",
);

assert.ok(
  graph.edges.some((edge) => edge.source.startsWith("memory:file:") && edge.target === "hub:memory-files"),
  "filesystem memory leaves should connect to the neutral files hub",
);

assert.equal(
  graph.nodes.find((node) => node.kind === "memory" && node.source === "file")?.familiarId,
  undefined,
  "filesystem memory leaves must not fake a familiar relationship",
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
  "memory leaves should be positioned on a shell around their hub, not on top of it",
);
assert.equal(
  scene.nodes.find((node) => node.id === "familiar:nova")?.memoryCount,
  2,
  "hub memory count should reflect total matching entries before visual leaf caps",
);
