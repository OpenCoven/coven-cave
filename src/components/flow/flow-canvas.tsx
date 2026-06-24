"use client";

import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnectStartParams,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { catalogNode } from "@/lib/flow/flow-catalog";
import type { FlowDoc, FlowPosition } from "@/lib/flow/flow-doc";
import {
  FlowNodeView,
  FlowStickyView,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  type FlowNodeData,
  type FlowNodePhase,
} from "./flow-node";
import { FlowEdge } from "./flow-edge";

const nodeTypes: NodeTypes = { flowNode: FlowNodeView, flowSticky: FlowStickyView };
const edgeTypes: EdgeTypes = { flowEdge: FlowEdge };

/** A handle a connection was dragged from (output `source` or input `target`). */
export type FlowConnectFrom = { nodeId: string; handleId: string; handleType: "source" | "target" };

export type FlowCanvasProps = {
  doc: FlowDoc;
  selectedNodeId: string | null;
  /** node id → live run phase, when an execution/preview is walking. */
  phases?: Record<string, FlowNodePhase> | null;
  activeNodeId?: string | null;
  viewResetKey: number;
  onSelectNode: (id: string | null) => void;
  onOpenNode: (id: string) => void;
  onConnect: (source: string, sourceHandle: string, target: string, targetHandle: string) => void;
  onDisconnect: (edgeId: string) => void;
  onRemoveNode: (id: string) => void;
  onMoveNodes: (positions: Record<string, FlowPosition>) => void;
  /** Open the node catalog to add a node at this flow-space position. */
  onRequestAdd: (position: FlowPosition) => void;
  /** Dragged a connection onto empty canvas — add a node wired to that handle. */
  onConnectToNew: (from: FlowConnectFrom, position: FlowPosition) => void;
  /** Clicked the "+" on an edge — splice a node into that connection. */
  onInsertEdge: (edgeId: string) => void;
};

function FlowCanvasInner(props: FlowCanvasProps) {
  const {
    doc,
    selectedNodeId,
    phases,
    activeNodeId,
    viewResetKey,
    onSelectNode,
    onOpenNode,
    onConnect,
    onDisconnect,
    onRemoveNode,
    onMoveNodes,
    onRequestAdd,
    onConnectToNew,
    onInsertEdge,
  } = props;
  const [showMiniMap, setShowMiniMap] = useState(false);
  const { screenToFlowPosition } = useReactFlow();
  // The handle a connection drag started from, captured so a drop on empty
  // canvas can wire the new node back to it.
  const connectFrom = useRef<FlowConnectFrom | null>(null);

  // Nodes live in local state so drags stay smooth; the doc is the source of
  // truth for structure, local state only owns in-flight positions.
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const nodesRef = useRef<Node<FlowNodeData>[]>([]);
  const mountedKey = useRef<string | null>(null);

  const docNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      doc.nodes.map((node) => {
        const def = catalogNode(node.type);
        return {
          id: node.id,
          type: def?.sticky ? "flowSticky" : "flowNode",
          position: node.position,
          data: { node, def },
          ...(def?.sticky
            ? { width: node.sticky?.width ?? 240, height: node.sticky?.height ?? 160 }
            : { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT }),
        } satisfies Node<FlowNodeData>;
      }),
    [doc.nodes],
  );

  useEffect(() => {
    setNodes((current) => {
      const key = `${doc.id}:${viewResetKey}`;
      const sameDoc = mountedKey.current === key;
      mountedKey.current = key;
      const live = new Map(current.map((node) => [node.id, node.position]));
      const next = docNodes.map((node) => ({
        ...node,
        position: (sameDoc ? live.get(node.id) : undefined) ?? node.position,
      }));
      nodesRef.current = next;
      return next;
    });
  }, [docNodes, doc.id, viewResetKey]);

  const renderNodes = useMemo(
    () =>
      nodes.map((node) => {
        const phase = phases?.[node.id];
        return {
          ...node,
          selected: node.id === selectedNodeId,
          data: phase ? { ...node.data, phase } : node.data,
        };
      }),
    [nodes, phases, selectedNodeId],
  );

  const edges = useMemo<Edge[]>(
    () =>
      doc.edges.map((edge) => {
        const isActive = activeNodeId != null && edge.target === activeNodeId;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: "flowEdge",
          animated: isActive,
          className: isActive ? "flow-edge-active" : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#7d83a8" },
          data: { onInsert: () => onInsertEdge(edge.id) },
        } satisfies Edge;
      }),
    [doc.edges, activeNodeId, onInsertEdge],
  );

  const handleNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      nodesRef.current = next;
      return next;
    });
  }, []);

  const handleNodeDragStop = useCallback(() => {
    onMoveNodes(Object.fromEntries(nodesRef.current.map((node) => [node.id, node.position])));
  }, [onMoveNodes]);

  const handleNodeClick: NodeMouseHandler<Node<FlowNodeData>> = useCallback(
    (_event, node) => onSelectNode(node.id),
    [onSelectNode],
  );

  const handleNodeDoubleClick: NodeMouseHandler<Node<FlowNodeData>> = useCallback(
    (_event, node) => onOpenNode(node.id),
    [onOpenNode],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      onConnect(
        connection.source,
        connection.sourceHandle ?? "main",
        connection.target,
        connection.targetHandle ?? "in",
      );
    },
    [onConnect],
  );

  const handleConnectStart = useCallback(
    (_event: unknown, params: OnConnectStartParams) => {
      connectFrom.current = params.nodeId
        ? {
            nodeId: params.nodeId,
            handleId: params.handleId ?? (params.handleType === "target" ? "in" : "main"),
            handleType: params.handleType === "target" ? "target" : "source",
          }
        : null;
    },
    [],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null }) => {
      const from = connectFrom.current;
      connectFrom.current = null;
      if (!from) return;
      // A valid drop (onto a handle) becomes a real connection via onConnect.
      // Only an invalid drop — empty canvas — opens the catalog for a new node.
      if (connectionState?.isValid) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const position = screenToFlowPosition({ x: point.clientX, y: point.clientY });
      onConnectToNew(from, position);
    },
    [onConnectToNew, screenToFlowPosition],
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) onDisconnect(edge.id);
    },
    [onDisconnect],
  );

  const handleNodesDelete = useCallback(
    (deleted: Node<FlowNodeData>[]) => {
      for (const node of deleted) onRemoveNode(node.id);
    },
    [onRemoveNode],
  );

  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // Only the empty canvas background adds a node — not a double-click on a
      // node (which opens its detail view) or on a control.
      const target = event.target as HTMLElement;
      if (!target.classList?.contains("react-flow__pane")) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onRequestAdd(position);
    },
    [onRequestAdd, screenToFlowPosition],
  );

  const handleAddCenter = useCallback(() => {
    if (typeof window === "undefined") return onRequestAdd({ x: 120, y: 120 });
    const position = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    onRequestAdd(position);
  }, [onRequestAdd, screenToFlowPosition]);

  return (
    <div className="flow-canvas" aria-label={`${doc.name} canvas`} onDoubleClick={handlePaneDoubleClick}>
      <div className="flow-canvas-toolbar">
        <button type="button" className="flow-canvas-tool flow-canvas-add" onClick={handleAddCenter} title="Add node (or double-click the canvas)">
          <Icon name="ph:plus" width={15} />
          <span>Add node</span>
        </button>
        <button
          type="button"
          className={`flow-canvas-tool${showMiniMap ? " is-active" : ""}`}
          aria-pressed={showMiniMap}
          onClick={() => setShowMiniMap((v) => !v)}
          title={showMiniMap ? "Hide minimap" : "Show minimap"}
        >
          <Icon name="ph:graph" width={14} />
        </button>
      </div>
      <ReactFlow
        key={`${doc.id}:${viewResetKey}`}
        nodes={renderNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable
        minZoom={0.2}
        maxZoom={2.5}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onPaneClick={() => onSelectNode(null)}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        onNodesDelete={handleNodesDelete}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
        {showMiniMap && (
          <MiniMap
            zoomable
            pannable
            position="bottom-right"
            nodeColor={(node) => (node.data as FlowNodeData)?.def?.accent ?? "#7b7f87"}
            nodeStrokeWidth={3}
            nodeBorderRadius={6}
            maskColor="rgb(0 0 0 / 48%)"
            bgColor="var(--card)"
            style={{ width: 168, height: 110 }}
          />
        )}
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
