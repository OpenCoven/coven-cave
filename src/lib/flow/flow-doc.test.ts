import assert from "node:assert/strict";
import {
  addNode,
  connect,
  disconnect,
  edgeId,
  emptyFlow,
  flowDraftReducer,
  initialFlowDraft,
  moveNodes,
  nextNodeId,
  removeNode,
  renameNode,
  sameDoc,
  setActive,
  setNodeParam,
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
  doc = setActive(doc, true);
  assert.equal(doc.active, true);
  assert.equal(setActive(doc, true), doc, "no-op active toggle returns same doc");
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

console.log("flow-doc.test.ts OK");
