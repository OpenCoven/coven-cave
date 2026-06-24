// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildTraceGraphSceneModel,
  edgeKey,
  renderPolicyForGraph,
  selectionObjectKey,
  traceGraphColor,
} from "./trace-graph-3d-model.ts";

const graph = {
  nodes: [
    { id: "nova", sentCount: 2, receivedCount: 1, sentExplicitCount: 2, receivedExplicitCount: 1, sentInferredCount: 0, receivedInferredCount: 0, hasRunningReceived: false, latestReceivedFailed: false, lastSeenAt: "2026-06-06T12:00:00.000Z" },
    { id: "cody", sentCount: 1, receivedCount: 2, sentExplicitCount: 1, receivedExplicitCount: 2, sentInferredCount: 0, receivedInferredCount: 0, hasRunningReceived: true, latestReceivedFailed: false, lastSeenAt: "2026-06-06T12:01:00.000Z" },
    { id: "sage", sentCount: 0, receivedCount: 1, sentExplicitCount: 0, receivedExplicitCount: 0, sentInferredCount: 0, receivedInferredCount: 1, hasRunningReceived: false, latestReceivedFailed: true, lastSeenAt: "2026-06-06T12:02:00.000Z" },
  ],
  edges: [
    { caller: "nova", callee: "cody", count: 2, explicitCount: 2, inferredCount: 0, source: "explicit", mostRecentRequest: "Build graph", hasRunning: true, latestStatus: "running", lastSeenAt: "2026-06-06T12:01:00.000Z", traces: [{ id: "trace-1" }] },
    { caller: "cody", callee: "nova", count: 1, explicitCount: 1, inferredCount: 0, source: "explicit", mostRecentRequest: "Review", hasRunning: false, latestStatus: "completed", lastSeenAt: "2026-06-06T12:00:30.000Z", traces: [] },
    { caller: "cody", callee: "sage", count: 1, explicitCount: 0, inferredCount: 1, source: "inferred", mostRecentRequest: "Research", hasRunning: false, latestStatus: "failed", lastSeenAt: "2026-06-06T12:02:00.000Z", traces: [] },
  ],
  traces: [{ id: "trace-1" }],
};

const model = buildTraceGraphSceneModel(graph, new Map([
  ["nova", "Nova"],
  ["cody", "Cody"],
  ["sage", "Sage"],
]));
const modelWithMemory = buildTraceGraphSceneModel(graph, new Map([
  ["nova", "Nova"],
  ["cody", "Cody"],
  ["sage", "Sage"],
]), new Map([
  ["cody", 3],
]));

assert.equal(model.nodes.length, 3);
assert.equal(model.edges.length, 3);
assert.equal(model.nodes[0].label, "Nova");
assert.equal(model.nodes[0].memoryCount, 0);
assert.equal(modelWithMemory.nodes.find((node) => node.id === "cody")?.memoryCount, 3);
assert.equal(modelWithMemory.nodes.find((node) => node.id === "nova")?.memoryCount, 0);
assert.equal(edgeKey(graph.edges[0]), "nova->cody->explicit");
assert.notDeepEqual(model.nodes[0].position, model.nodes[1].position);
assert.equal(selectionObjectKey({ kind: "trace", id: "trace-1" }, graph), "edge:nova->cody->explicit");

assert.equal(traceGraphColor(graph.edges[0]), "#62d08f");
assert.equal(traceGraphColor(graph.edges[2]), "#f87171");
assert.equal(renderPolicyForGraph({ nodeCount: 12, edgeCount: 24 }).detail, "full");

const densePolicy = renderPolicyForGraph({ nodeCount: 70, edgeCount: 160 });
assert.equal(densePolicy.detail, "reduced");
assert.equal(densePolicy.animateParticles, false);
assert.equal(densePolicy.showLabels, true);

const extremePolicy = renderPolicyForGraph({ nodeCount: 130, edgeCount: 500 });
assert.equal(extremePolicy.detail, "summary");
assert.equal(extremePolicy.animateParticles, false);
assert.equal(extremePolicy.showLabels, false);
assert.equal(extremePolicy.maxRenderedEdges, 180);
