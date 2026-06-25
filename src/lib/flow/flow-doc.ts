// FlowDoc — the n8n-style flow document model for the Flow editor.
//
// A FlowDoc is a freeform node graph: nodes carry their own canvas position,
// parameters, and disabled/notes state; edges connect a source node's named
// output port to a target node's input port. Unlike the layered Workflow
// Studio (which derives layout from dependency depth), Flow nodes live wherever
// the user drags them — the n8n editing model.
//
// Everything here is pure and framework-free so it unit-tests without React or
// @xyflow. The canvas maps FlowNode → React Flow node at render time; the
// handle ids it wires come from the node type's input/output ports in the
// catalog (see flow-catalog.ts).

export type FlowPosition = { x: number; y: number };

export type FlowParamValue = string | number | boolean;

export type FlowStickyData = {
  text: string;
  /** Palette key from flow-catalog STICKY_COLORS; falls back to the first. */
  color: string;
  width: number;
  height: number;
};

export type FlowExecutionDataPolicy = {
  /** Manual editor/test runs omit persisted per-node details when true. */
  redactManual?: boolean;
  /** Production trigger runs omit persisted per-node details when true. */
  redactProduction?: boolean;
};

export type FlowNode = {
  id: string;
  /** Node type id from the catalog, e.g. "trigger.manual", "logic.if". */
  type: string;
  /** Instance display name (n8n lets you rename a node). */
  name: string;
  position: FlowPosition;
  params: Record<string, FlowParamValue>;
  /** Disabled nodes are skipped at run time but stay on the canvas. */
  disabled?: boolean;
  /** Development-only pinned output reused by manual/partial runs. */
  pinnedData?: string;
  notes?: string;
  /** Present only on sticky-note nodes. */
  sticky?: FlowStickyData;
};

export type FlowEdge = {
  id: string;
  source: string;
  /** Output port id on the source node (e.g. "main", "true", "false"). */
  sourceHandle: string;
  target: string;
  /** Input port id on the target node (e.g. "in", "in-0", "in-1"). */
  targetHandle: string;
};

export const FLOW_SCHEMA_VERSION = 1;

export type FlowDoc = {
  id: string;
  name: string;
  /** n8n "Active" toggle — whether the flow's triggers are armed. */
  active: boolean;
  /** Execution-history data retention policy. */
  executionData?: FlowExecutionDataPolicy;
  nodes: FlowNode[];
  edges: FlowEdge[];
  createdAt: string;
  updatedAt: string;
  schema: number;
};

export function emptyFlow(id: string, name: string, now: string): FlowDoc {
  return {
    id,
    name,
    active: false,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
    schema: FLOW_SCHEMA_VERSION,
  };
}

/** A unique, readable node id derived from the type's short suffix. */
export function nextNodeId(doc: FlowDoc, type: string): string {
  const base = type.includes(".") ? type.slice(type.indexOf(".") + 1) : type;
  const taken = new Set(doc.nodes.map((node) => node.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** A unique node display name within the doc (n8n appends a counter). */
export function uniqueNodeName(doc: FlowDoc, label: string): string {
  const taken = new Set(doc.nodes.map((node) => node.name));
  if (!taken.has(label)) return label;
  let n = 1;
  while (taken.has(`${label} ${n}`)) n += 1;
  return `${label} ${n}`;
}

export function findNode(doc: FlowDoc, id: string): FlowNode | undefined {
  return doc.nodes.find((node) => node.id === id);
}

export function addNode(doc: FlowDoc, node: FlowNode): FlowDoc {
  if (doc.nodes.some((existing) => existing.id === node.id)) return doc;
  return { ...doc, nodes: [...doc.nodes, node] };
}

export function removeNode(doc: FlowDoc, id: string): FlowDoc {
  if (!doc.nodes.some((node) => node.id === id)) return doc;
  return {
    ...doc,
    nodes: doc.nodes.filter((node) => node.id !== id),
    // Dropping a node strands its edges — remove any edge touching it.
    edges: doc.edges.filter((edge) => edge.source !== id && edge.target !== id),
  };
}

export function moveNode(doc: FlowDoc, id: string, position: FlowPosition): FlowDoc {
  return mapNode(doc, id, (node) => ({ ...node, position }));
}

export function moveNodes(doc: FlowDoc, positions: Record<string, FlowPosition>): FlowDoc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    const next = positions[node.id];
    if (!next || (next.x === node.position.x && next.y === node.position.y)) return node;
    changed = true;
    return { ...node, position: next };
  });
  return changed ? { ...doc, nodes } : doc;
}

export function renameNode(doc: FlowDoc, id: string, name: string): FlowDoc {
  const trimmed = name.trim();
  if (!trimmed) return doc;
  return mapNode(doc, id, (node) => ({ ...node, name: uniqueRename(doc, id, trimmed) }));
}

export function setNodeParam(doc: FlowDoc, id: string, key: string, value: FlowParamValue): FlowDoc {
  return mapNode(doc, id, (node) => ({ ...node, params: { ...node.params, [key]: value } }));
}

export function setNodeNotes(doc: FlowDoc, id: string, notes: string): FlowDoc {
  return mapNode(doc, id, (node) => ({ ...node, notes }));
}

export function setNodePinnedData(doc: FlowDoc, id: string, pinnedData: string): FlowDoc {
  const trimmed = pinnedData.trim();
  return mapNode(doc, id, (node) => {
    if (!trimmed) {
      const { pinnedData: _pinnedData, ...rest } = node;
      return rest;
    }
    return { ...node, pinnedData: trimmed };
  });
}

export function setExecutionDataRedaction(
  doc: FlowDoc,
  mode: "manual" | "production",
  redacted: boolean,
): FlowDoc {
  const key = mode === "production" ? "redactProduction" : "redactManual";
  const executionData: FlowExecutionDataPolicy = { ...(doc.executionData ?? {}) };
  if (redacted) executionData[key] = true;
  else delete executionData[key];
  return Object.keys(executionData).length > 0
    ? { ...doc, executionData }
    : omitExecutionData(doc);
}

export function flowRunRedactsData(doc: FlowDoc, mode: "manual" | "production"): boolean {
  return mode === "production"
    ? doc.executionData?.redactProduction === true
    : doc.executionData?.redactManual === true;
}

export function setPinnedDataForNodes(doc: FlowDoc, pinnedDataByNodeId: Record<string, string>): FlowDoc {
  let next = doc;
  for (const [id, pinnedData] of Object.entries(pinnedDataByNodeId)) {
    if (!pinnedData.trim()) continue;
    next = setNodePinnedData(next, id, pinnedData);
  }
  return next;
}

function omitExecutionData(doc: FlowDoc): FlowDoc {
  const { executionData: _executionData, ...rest } = doc;
  return rest;
}

export function toggleNodeDisabled(doc: FlowDoc, id: string): FlowDoc {
  return mapNode(doc, id, (node) => ({ ...node, disabled: !node.disabled }));
}

export function updateSticky(doc: FlowDoc, id: string, patch: Partial<FlowStickyData>): FlowDoc {
  return mapNode(doc, id, (node) =>
    node.sticky ? { ...node, sticky: { ...node.sticky, ...patch } } : node,
  );
}

export function setActive(doc: FlowDoc, active: boolean): FlowDoc {
  return doc.active === active ? doc : { ...doc, active };
}

export function renameFlow(doc: FlowDoc, name: string): FlowDoc {
  const trimmed = name.trim();
  if (!trimmed || trimmed === doc.name) return doc;
  return { ...doc, name: trimmed };
}

export function edgeId(source: string, sourceHandle: string, target: string, targetHandle: string): string {
  return `${source}:${sourceHandle}->${target}:${targetHandle}`;
}

/**
 * Connect a source output to a target input. Rejects self-loops and exact
 * duplicates. Cycles are allowed on purpose — Loop nodes feed an upstream
 * node, which is a legitimate n8n pattern.
 */
export function connect(
  doc: FlowDoc,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): FlowDoc {
  if (source === target) return doc;
  if (!findNode(doc, source) || !findNode(doc, target)) return doc;
  const id = edgeId(source, sourceHandle, target, targetHandle);
  if (doc.edges.some((edge) => edge.id === id)) return doc;
  return { ...doc, edges: [...doc.edges, { id, source, sourceHandle, target, targetHandle }] };
}

export function disconnect(doc: FlowDoc, id: string): FlowDoc {
  if (!doc.edges.some((edge) => edge.id === id)) return doc;
  return { ...doc, edges: doc.edges.filter((edge) => edge.id !== id) };
}

export function disconnectEndpoints(doc: FlowDoc, source: string, target: string): FlowDoc {
  return { ...doc, edges: doc.edges.filter((edge) => !(edge.source === source && edge.target === target)) };
}

export function nodeExecutionChangedSinceSnapshot(
  current: FlowDoc,
  snapshot: FlowDoc | undefined,
  nodeId: string,
): boolean {
  if (!snapshot) return false;
  return nodeExecutionSignature(current, nodeId) !== nodeExecutionSignature(snapshot, nodeId);
}

/**
 * Splice a new node into an existing edge: `A → B` becomes `A → node → B`.
 * The original edge is removed and two new edges wire the node in through its
 * given input/output handles. No-op if the edge or node is missing.
 */
export function spliceNodeOnEdge(
  doc: FlowDoc,
  edgeId: string,
  node: FlowNode,
  inHandle: string,
  outHandle: string,
): FlowDoc {
  const edge = doc.edges.find((e) => e.id === edgeId);
  if (!edge) return doc;
  let next = addNode(doc, node);
  next = disconnect(next, edgeId);
  next = connect(next, edge.source, edge.sourceHandle, node.id, inHandle);
  next = connect(next, node.id, outHandle, edge.target, edge.targetHandle);
  return next;
}

/**
 * Add a node and wire it to a handle a connection was dragged from. Dragging
 * from an output (`source`) connects that output into the new node's input;
 * dragging from an input (`target`) connects the new node's output into it.
 */
export function addConnectedNode(
  doc: FlowDoc,
  node: FlowNode,
  from: { nodeId: string; handleId: string; handleType: "source" | "target" },
  inHandle: string,
  outHandle: string,
): FlowDoc {
  let next = addNode(doc, node);
  if (from.handleType === "target") {
    next = connect(next, node.id, outHandle, from.nodeId, from.handleId);
  } else {
    next = connect(next, from.nodeId, from.handleId, node.id, inHandle);
  }
  return next;
}

function nodeExecutionSignature(doc: FlowDoc, nodeId: string): string | null {
  const node = findNode(doc, nodeId);
  if (!node) return null;
  const edges = doc.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    }))
    .sort(compareEdgeSignatures);
  return JSON.stringify({
    type: node.type,
    params: sortedRecord(node.params),
    disabled: Boolean(node.disabled),
    pinnedData: node.pinnedData?.trim() ?? "",
    sticky: node.sticky
      ? {
          color: node.sticky.color,
          height: node.sticky.height,
          text: node.sticky.text,
          width: node.sticky.width,
        }
      : null,
    edges,
  });
}

function sortedRecord(record: Record<string, FlowParamValue>): Record<string, FlowParamValue> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function compareEdgeSignatures(
  a: Pick<FlowEdge, "source" | "sourceHandle" | "target" | "targetHandle">,
  b: Pick<FlowEdge, "source" | "sourceHandle" | "target" | "targetHandle">,
): number {
  return (
    a.source.localeCompare(b.source) ||
    a.sourceHandle.localeCompare(b.sourceHandle) ||
    a.target.localeCompare(b.target) ||
    a.targetHandle.localeCompare(b.targetHandle)
  );
}

function mapNode(doc: FlowDoc, id: string, fn: (node: FlowNode) => FlowNode): FlowDoc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    if (node.id !== id) return node;
    const next = fn(node);
    if (next !== node) changed = true;
    return next;
  });
  return changed ? { ...doc, nodes } : doc;
}

function uniqueRename(doc: FlowDoc, id: string, name: string): string {
  const taken = new Set(doc.nodes.filter((node) => node.id !== id).map((node) => node.name));
  if (!taken.has(name)) return name;
  let n = 1;
  while (taken.has(`${name} ${n}`)) n += 1;
  return `${name} ${n}`;
}

// ---------------------------------------------------------------------------
// Draft state: undo/redo around the editing surface, mirroring workflow-draft.
// ---------------------------------------------------------------------------

const UNDO_LIMIT = 60;

export type FlowDraftState = {
  doc: FlowDoc;
  /** The last saved snapshot, to compute `dirty` and to diff on save. */
  saved: FlowDoc;
  past: FlowDoc[];
  future: FlowDoc[];
  dirty: boolean;
};

export function initialFlowDraft(doc: FlowDoc): FlowDraftState {
  return { doc, saved: doc, past: [], future: [], dirty: false };
}

export type FlowDraftAction =
  | { type: "reset"; doc: FlowDoc }
  | { type: "mark-saved"; doc: FlowDoc }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "apply"; next: FlowDoc };

export function flowDraftReducer(state: FlowDraftState, action: FlowDraftAction): FlowDraftState {
  switch (action.type) {
    case "reset":
      return initialFlowDraft(action.doc);
    case "mark-saved":
      return { ...state, doc: action.doc, saved: action.doc, dirty: false };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future].slice(0, UNDO_LIMIT),
        dirty: !sameDoc(previous, state.saved),
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        doc: next,
        past: [...state.past, state.doc].slice(-UNDO_LIMIT),
        future: state.future.slice(1),
        dirty: !sameDoc(next, state.saved),
      };
    }
    case "apply": {
      if (action.next === state.doc) return state;
      return {
        ...state,
        doc: action.next,
        past: [...state.past, state.doc].slice(-UNDO_LIMIT),
        future: [],
        dirty: !sameDoc(action.next, state.saved),
      };
    }
    default:
      return state;
  }
}

/** Structural equality ignoring timestamps (so a no-op edit stays clean). */
export function sameDoc(a: FlowDoc, b: FlowDoc): boolean {
  return (
    a.name === b.name &&
    a.active === b.active &&
    JSON.stringify(a.nodes) === JSON.stringify(b.nodes) &&
    JSON.stringify(a.edges) === JSON.stringify(b.edges)
  );
}
