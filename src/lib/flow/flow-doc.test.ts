import assert from "node:assert/strict";
import {
  addConnectedNode,
  addNode,
  connect,
  disconnect,
  edgeId,
  emptyFlow,
  flowRunRedactsData,
  flowDraftReducer,
  initialFlowDraft,
  moveNodes,
  nextNodeId,
  nodeExecutionChangedSinceSnapshot,
  removeNode,
  renameNode,
  sameDoc,
  setActive,
  setExecutionDataRedaction,
  setNodeParam,
  setNodePinnedData,
  setPinnedDataForNodes,
  spliceNodeOnEdge,
  uniqueNodeName,
  type FlowDoc,
  type FlowNode,
} from "./flow-doc.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function node(id: string, type = "familiar", x = 0, y = 0): FlowNode {
  return { id, type, name: id, position: { x, y }, params: {} };
}

function base(): FlowDoc {
  let doc = emptyFlow("f1", "Flow", NOW);
  doc = addNode(doc, node("trigger", "trigger.manual"));
  doc = addNode(doc, node("a", "familiar"));
  doc = addNode(doc, node("b", "familiar"));
  return doc;
}

// emptyFlow
{
  const doc = emptyFlow("x", "X", NOW);
  assert.equal(doc.nodes.length, 0);
  assert.equal(doc.edges.length, 0);
  assert.equal(doc.active, false);
  assert.equal(doc.schema, 1);
}

// nextNodeId / uniqueNodeName
{
  const doc = base();
  assert.equal(nextNodeId(doc, "logic.if"), "if");
  assert.equal(nextNodeId(doc, "familiar"), "familiar");
  const withFam = addNode(doc, node("familiar", "familiar"));
  assert.equal(nextNodeId(withFam, "familiar"), "familiar-2");
  assert.equal(uniqueNodeName(doc, "a"), "a 1");
  assert.equal(uniqueNodeName(doc, "fresh"), "fresh");
}

// addNode ignores duplicate ids
{
  const doc = base();
  const same = addNode(doc, node("a"));
  assert.equal(same.nodes.length, doc.nodes.length, "duplicate id is a no-op");
}

// connect: rejects self-loop and exact duplicate; allows cycle
{
  let doc = base();
  doc = connect(doc, "trigger", "main", "a", "in");
  assert.equal(doc.edges.length, 1);
  assert.equal(doc.edges[0].id, edgeId("trigger", "main", "a", "in"));
  // duplicate
  doc = connect(doc, "trigger", "main", "a", "in");
  assert.equal(doc.edges.length, 1, "duplicate edge ignored");
  // self loop
  doc = connect(doc, "a", "main", "a", "in");
  assert.equal(doc.edges.length, 1, "self-loop ignored");
  // cycle is allowed (loop pattern)
  doc = connect(doc, "a", "main", "b", "in");
  doc = connect(doc, "b", "main", "a", "in");
  assert.equal(doc.edges.length, 3, "cycles allowed");
  // unknown endpoint
  doc = connect(doc, "ghost", "main", "a", "in");
  assert.equal(doc.edges.length, 3, "unknown source ignored");
}

// removeNode drops connected edges
{
  let doc = base();
  doc = connect(doc, "trigger", "main", "a", "in");
  doc = connect(doc, "a", "main", "b", "in");
  doc = removeNode(doc, "a");
  assert.equal(doc.nodes.length, 2);
  assert.equal(doc.edges.length, 0, "edges touching removed node are dropped");
}

// disconnect by id
{
  let doc = base();
  doc = connect(doc, "trigger", "main", "a", "in");
  const id = doc.edges[0].id;
  doc = disconnect(doc, id);
  assert.equal(doc.edges.length, 0);
}

// moveNodes
{
  let doc = base();
  doc = moveNodes(doc, { a: { x: 99, y: 88 } });
  assert.deepEqual(doc.nodes.find((n) => n.id === "a")?.position, { x: 99, y: 88 });
  const unchanged = moveNodes(doc, { a: { x: 99, y: 88 } });
  assert.equal(unchanged, doc, "no-op move returns the same doc");
}

// renameNode keeps names unique
{
  let doc = base();
  doc = renameNode(doc, "b", "a");
  assert.equal(doc.nodes.find((n) => n.id === "b")?.name, "a 1");
}

// setNodeParam / setActive
{
  let doc = base();
  doc = setNodeParam(doc, "a", "prompt", "hello");
  assert.equal(doc.nodes.find((n) => n.id === "a")?.params.prompt, "hello");
  doc = setNodePinnedData(doc, "a", '{"ok":true}');
  assert.equal(doc.nodes.find((n) => n.id === "a")?.pinnedData, '{"ok":true}', "pinned output is stored on the node");
  doc = setNodePinnedData(doc, "a", "");
  assert.equal(doc.nodes.find((n) => n.id === "a")?.pinnedData, undefined, "blank pinned output unpins the node");
  doc = setActive(doc, true);
  assert.equal(doc.active, true);
  assert.equal(setActive(doc, true), doc, "no-op active toggle returns same doc");
}

// setPinnedDataForNodes applies execution data to matching nodes only
{
  const doc = setPinnedDataForNodes(base(), {
    trigger: "trigger fired",
    a: "agent output",
    ghost: "ignored",
    b: "   ",
  });
  assert.equal(doc.nodes.find((n) => n.id === "trigger")?.pinnedData, "trigger fired");
  assert.equal(doc.nodes.find((n) => n.id === "a")?.pinnedData, "agent output");
  assert.equal(doc.nodes.find((n) => n.id === "b")?.pinnedData, undefined, "blank execution detail is not pinned");
  assert.equal(doc.nodes.some((n) => n.id === "ghost"), false, "unknown execution node ids do not create nodes");
}

// execution-data redaction policy can differ for manual and production runs
{
  let doc = base();
  assert.equal(flowRunRedactsData(doc, "manual"), false, "missing policy keeps manual run data inspectable");
  assert.equal(flowRunRedactsData(doc, "production"), false, "missing policy keeps production run data inspectable");

  doc = setExecutionDataRedaction(doc, "manual", true);
  assert.equal(flowRunRedactsData(doc, "manual"), true, "manual runs can redact stored execution data");
  assert.equal(flowRunRedactsData(doc, "production"), false, "production policy remains independent");

  doc = setExecutionDataRedaction(doc, "production", true);
  assert.equal(flowRunRedactsData(doc, "production"), true, "production runs can redact stored execution data");

  doc = setExecutionDataRedaction(doc, "manual", false);
  assert.equal(flowRunRedactsData(doc, "manual"), false, "manual redaction can be disabled");
  assert.deepEqual(doc.executionData, { redactProduction: true }, "false policy values are omitted");
}

// draft reducer: apply/undo/redo + dirty
{
  let state = initialFlowDraft(base());
  assert.equal(state.dirty, false);
  state = flowDraftReducer(state, { type: "apply", next: setActive(state.doc, true) });
  assert.equal(state.dirty, true);
  assert.equal(state.doc.active, true);
  state = flowDraftReducer(state, { type: "undo" });
  assert.equal(state.doc.active, false);
  assert.equal(state.dirty, false, "undo back to saved is clean");
  state = flowDraftReducer(state, { type: "redo" });
  assert.equal(state.doc.active, true);
  assert.equal(state.dirty, true);
  state = flowDraftReducer(state, { type: "mark-saved", doc: state.doc });
  assert.equal(state.dirty, false, "mark-saved clears dirty");
}

// sameDoc ignores timestamps
{
  const a = base();
  const b = { ...a, updatedAt: "2099-01-01T00:00:00.000Z" };
  assert.equal(sameDoc(a, b), true);
  assert.equal(sameDoc(a, setActive(a, true)), false);
}

// execution signatures ignore canvas-only edits but flag stale run data
{
  let snapshot = base();
  snapshot = connect(snapshot, "trigger", "main", "a", "in");
  const moved = moveNodes(snapshot, { a: { x: 500, y: 120 } });
  const renamed = renameNode(snapshot, "a", "Renamed display only");
  const noted = { ...snapshot, nodes: snapshot.nodes.map((n) => n.id === "a" ? { ...n, notes: "operator note" } : n) };
  assert.equal(nodeExecutionChangedSinceSnapshot(moved, snapshot, "a"), false, "position-only edits keep run data fresh");
  assert.equal(nodeExecutionChangedSinceSnapshot(renamed, snapshot, "a"), false, "display-name edits keep run data fresh");
  assert.equal(nodeExecutionChangedSinceSnapshot(noted, snapshot, "a"), false, "notes-only edits keep run data fresh");
  assert.equal(nodeExecutionChangedSinceSnapshot(snapshot, undefined, "a"), false, "old runs without snapshots are not marked stale");

  assert.equal(
    nodeExecutionChangedSinceSnapshot(setNodeParam(snapshot, "a", "prompt", "new"), snapshot, "a"),
    true,
    "param edits make stored run data stale",
  );
  assert.equal(
    nodeExecutionChangedSinceSnapshot(setNodePinnedData(snapshot, "a", "fixture"), snapshot, "a"),
    true,
    "pinned-data edits make stored run data stale",
  );
  assert.equal(
    nodeExecutionChangedSinceSnapshot(connect(snapshot, "a", "main", "b", "in"), snapshot, "a"),
    true,
    "edge edits touching the node make stored run data stale",
  );
  assert.equal(
    nodeExecutionChangedSinceSnapshot(removeNode(snapshot, "a"), snapshot, "a"),
    true,
    "missing current node makes stored run data stale",
  );
}

// spliceNodeOnEdge: A→B becomes A→mid→B
{
  let doc = base();
  doc = connect(doc, "a", "main", "b", "in");
  const eid = doc.edges[0].id;
  const mid = node("mid", "logic.filter");
  doc = spliceNodeOnEdge(doc, eid, mid, "in", "main");
  assert.ok(doc.nodes.some((n) => n.id === "mid"), "node added");
  assert.ok(!doc.edges.some((e) => e.id === eid), "original edge removed");
  assert.ok(doc.edges.some((e) => e.source === "a" && e.target === "mid"), "A→mid");
  assert.ok(doc.edges.some((e) => e.source === "mid" && e.target === "b"), "mid→B");
  assert.equal(doc.edges.length, 2);
  // bad edge id → no-op
  assert.equal(spliceNodeOnEdge(doc, "nope", node("z"), "in", "main").nodes.length, doc.nodes.length);
}

// addConnectedNode: drag from an output connects output→new
{
  let doc = base();
  doc = addConnectedNode(doc, node("fresh", "familiar"), { nodeId: "a", handleId: "main", handleType: "source" }, "in", "main");
  assert.ok(doc.nodes.some((n) => n.id === "fresh"));
  assert.ok(doc.edges.some((e) => e.source === "a" && e.sourceHandle === "main" && e.target === "fresh" && e.targetHandle === "in"));
}

// addConnectedNode: drag from an input connects new→input
{
  let doc = base();
  doc = addConnectedNode(doc, node("up", "familiar"), { nodeId: "b", handleId: "in", handleType: "target" }, "in", "main");
  assert.ok(doc.edges.some((e) => e.source === "up" && e.sourceHandle === "main" && e.target === "b" && e.targetHandle === "in"));
}

console.log("flow-doc.test.ts OK");
