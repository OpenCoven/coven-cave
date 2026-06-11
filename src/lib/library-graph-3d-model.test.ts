// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildGraphSnapshotBTree,
  buildLibraryGraphSceneModel,
  diffGraphSnapshots,
  rangeGraphSnapshots,
} from "./library-graph-3d-model.ts";

const graph = {
  nodes: [
    { id: "a", label: "Route", type: "file", weight: 2 },
    { id: "b", label: "Vault", type: "module", weight: 1 },
    { id: "c", label: "Graphify", type: "tool", weight: 3 },
  ],
  edges: [
    { source: "a", target: "b", label: "reads" },
    { source: "a", target: "c", label: "spawns" },
  ],
};

const scene = buildLibraryGraphSceneModel(graph);
assert.equal(scene.nodes.length, 3, "scene should project every graph node");
assert.equal(scene.edges.length, 2, "scene should project every valid graph edge");
assert.equal(scene.policy.detail, "full", "small graphs should render in full detail");
assert.ok(scene.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.z)), "nodes should have finite 3D positions");

const denseGraph = {
  nodes: Array.from({ length: 220 }, (_, index) => ({ id: `n${index}`, label: `Node ${index}` })),
  edges: Array.from({ length: 420 }, (_, index) => ({ source: `n${index % 220}`, target: `n${(index + 7) % 220}` })),
};
const denseScene = buildLibraryGraphSceneModel(denseGraph);
assert.equal(denseScene.policy.detail, "summary", "dense graphs should degrade before WebGL becomes noisy");
assert.equal(denseScene.edges.length, denseScene.policy.maxRenderedEdges, "dense graph edges should be capped by policy");

const snapshots = [
  { id: "late", targetPath: "/repo", generatedAt: "2026-06-11T15:05:00.000Z", status: "completed", nodeCount: 10, edgeCount: 20 },
  { id: "other", targetPath: "/other", generatedAt: "2026-06-11T15:02:00.000Z", status: "completed", nodeCount: 1, edgeCount: 2 },
  { id: "early", targetPath: "/repo", generatedAt: "2026-06-11T15:01:00.000Z", status: "started", nodeCount: 4, edgeCount: 6 },
];
const tree = buildGraphSnapshotBTree(snapshots);
assert.deepEqual(
  rangeGraphSnapshots(tree, "/repo").map((snapshot) => snapshot.id),
  ["early", "late"],
  "snapshot range scans should be btree-key ordered by target path then timestamp",
);
assert.deepEqual(
  diffGraphSnapshots(snapshots[2], snapshots[0]),
  { nodeDelta: 6, edgeDelta: 14 },
  "snapshot deltas should compare node and edge counts",
);

console.log("library-graph-3d-model.test.ts: ok");
