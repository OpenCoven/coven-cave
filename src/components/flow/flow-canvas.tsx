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
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { catalogNode } from "@/lib/flow/flow-catalog";
import type { FlowDoc, FlowLayoutOrientation, FlowPosition } from "@/lib/flow/flow-doc";
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
  /** node id → run data is stale relative to the active run snapshot. */
  staleNodeIds?: Record<string, boolean>;
  activeNodeId?: string | null;
  viewResetKey: number;
  layoutOrientation: FlowLayoutOrientation;
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
  /** Sticky-note inline edits. */
  onStickyText: (id: string, text: string) => void;
  onStickySize: (id: string, width: number, height: number) => void;
  onTidy: () => void;
  onLayoutOrientation: (orientation: FlowLayoutOrientation) => void;
};

function FlowCanvasInner(props: FlowCanvasProps) {
  const {
    doc,
    selectedNodeId,
    phases,
    staleNodeIds,
    activeNodeId,
    viewResetKey,
    layoutOrientation,
    onSelectNode,
    onOpenNode,
    onConnect,
    onDisconnect,
    onRemoveNode,
    onMoveNodes,
    onRequestAdd,
    onConnectToNew,
    onInsertEdge,
    onStickyText,
    onStickySize,
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

  const docNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      doc.nodes.map((node) => {
        const def = catalogNode(node.type);
        const isSticky = def?.sticky === true;
        return {
          id: node.id,
          type: isSticky ? "flowSticky" : "flowNode",
          // Accessible name — without it every node announces only "node" and a
          // screen-reader user can't tell them apart.
          ariaLabel: isSticky
            ? "Sticky note"
            : `${node.name}, ${def?.label ?? node.type}${node.disabled ? ", disabled" : ""}`,
          position: node.position,
          data: isSticky
            ? {
                node,
                def,
                onStickyText: (text: string) => onStickyText(node.id, text),
                onStickySize: (width: number, height: number) => onStickySize(node.id, width, height),
              }
            : { node, def, orientation: layoutOrientation },
          ...(isSticky
            ? { width: node.sticky?.width ?? 240, height: node.sticky?.height ?? 160 }
            : { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT }),
        } satisfies Node<FlowNodeData>;
      }),
    [doc.nodes, onStickyText, onStickySize, layoutOrientation],
  );

  // Identity for the current canvas "view": changes when the flow is switched
  // or a relayout/reset bumps viewResetKey (Tidy, orientation flip). ReactFlow
  // remounts on this same key to re-fit the viewport.
  const viewKey = `${doc.id}:${viewResetKey}`;
  const [syncedViewKey, setSyncedViewKey] = useState(viewKey);

  // Adopt the doc's positions *during render* on a view change, so the
  // remounting ReactFlow paints at the new layout immediately. A post-commit
  // effect can't do this: the fresh canvas mounts with the previous positions
  // and ignores the later controlled update, so a Tidy / orientation switch
  // looked inert (the doc moved but the nodes stayed put).
if (syncedViewKey !== viewKey) {
  setSyncedViewKey(viewKey);
  setNodes(docNodes);
}

  // While the view is stable, reconcile structural edits (added/removed nodes)
  // without clobbering the live in-flight positions that keep dragging smooth.
  useEffect(() => {
    if (syncedViewKey !== viewKey) return;
    setNodes((current) => {
      const live = new Map(current.map((node) => [node.id, node.position]));
      const next = docNodes.map((node) => ({
        ...node,
        position: live.get(node.id) ?? node.position,
      }));
      nodesRef.current = next;
      return next;
    });
  }, [docNodes, syncedViewKey, viewKey]);

  const renderNodes = useMemo(
    () =>
      nodes.map((node) => {
        const phase = phases?.[node.id];
        const stale = staleNodeIds?.[node.id] === true;
        return {
          ...node,
          // Union, not override: React Flow's own selection state (shift-drag
          // marquee, shift-click multi) must survive alongside the detail-panel
          // selection — forcing `selected` from selectedNodeId alone silently
          // killed multi-select.
          selected: node.selected === true || node.id === selectedNodeId,
          data: phase || stale ? { ...node.data, ...(phase ? { phase } : {}), ...(stale ? { stale } : {}) } : node.data,
        };
      }),
    [nodes, phases, selectedNodeId, staleNodeIds],
  );

  const nodeDefinitionsById = useMemo(
    () => new Map(docNodes.map((node) => [node.id, node.data.def])),
    [docNodes],
  );

  const edges = useMemo<Edge[]>(
    () =>
      doc.edges.map((edge) => {
        const isActive = activeNodeId != null && edge.target === activeNodeId;
        // Branch label: when the source node fans out over several labeled
        // ports (router/if/loop), name the branch on the wire itself — the
        // tiny port badge alone doesn't survive a glance at a busy canvas.
        const sourceDef = nodeDefinitionsById.get(edge.source);
        const branchLabel =
          sourceDef && sourceDef.outputs.length > 1
            ? sourceDef.outputs.find((port) => port.id === edge.sourceHandle)?.label
            : undefined;
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
          data: { onInsert: () => onInsertEdge(edge.id), branchLabel },
        } satisfies Edge;
      }),
    [doc.edges, nodeDefinitionsById, activeNodeId, onInsertEdge],
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

  const { announce } = useAnnouncer();

  const handleNodeClick: NodeMouseHandler<Node<FlowNodeData>> = useCallback(
    (_event, node) => onSelectNode(node.id),
    [onSelectNode],
  );

  const handleNodeDoubleClick: NodeMouseHandler<Node<FlowNodeData>> = useCallback(
    (_event, node) => {
      // Sticky notes edit their text inline on double-click; don't also open
      // the detail view.
      if (node.type === "flowSticky") return;
      onOpenNode(node.id);
    },
    [onOpenNode],
  );

  // Keyboard path to open a node (WCAG 2.1.1): double-click is mouse-only, so a
  // keyboard user could Tab to a focusable React Flow node and select it but
  // never open it. Enter/Space on the focused node opens its detail view,
  // mirroring double-click (stickies edit inline, so they're skipped). Keyed off
  // the focused node's `data-id` rather than selection, so it works the instant
  // focus lands. The NDV doesn't announce itself, so announce the open here.
  const handleCanvasKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target as HTMLElement | null;
      const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
      const nodeId = nodeEl?.getAttribute("data-id");
      if (!nodeId) return; // focus is on the toolbar / pane / an input, not a node
      const source = doc.nodes.find((entry) => entry.id === nodeId);
      if (!source || catalogNode(source.type)?.sticky === true) return;
      event.preventDefault(); // Space would page-scroll / toggle selection
      onOpenNode(nodeId);
      announce(`Opened ${source.name} settings`);
    },
    [doc.nodes, onOpenNode, announce],
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
    <div className="flow-canvas" aria-label={`${doc.name} canvas`} onDoubleClick={handlePaneDoubleClick} onKeyDown={handleCanvasKeyDown}>
      <div className="flow-canvas-toolbar">
        <Button
          variant="secondary"
          size="xs"
          leadingIcon="ph:plus"
          className="flow-canvas-tool flow-canvas-add"
          onClick={handleAddCenter}
          title="Add node (or double-click the canvas)"
        >
          Add node
        </Button>
        <IconButton
          icon="ph:graph"
          size="sm"
          active={showMiniMap}
          className={`flow-canvas-tool${showMiniMap ? " is-active" : ""}`}
          aria-pressed={showMiniMap}
          aria-label={showMiniMap ? "Hide minimap" : "Show minimap"}
          onClick={() => setShowMiniMap((v) => !v)}
          title={showMiniMap ? "Hide minimap" : "Show minimap"}
        />
        <div className="flow-canvas-layout-toggle" role="group" aria-label="Flow layout orientation">
          <IconButton
            icon="ph:columns"
            size="sm"
            active={layoutOrientation === "horizontal"}
            className={`flow-canvas-tool flow-canvas-layout-tool${layoutOrientation === "horizontal" ? " is-active" : ""}`}
            aria-pressed={layoutOrientation === "horizontal"}
            aria-label="Use horizontal layout"
            title="Use horizontal layout"
            onClick={() => props.onLayoutOrientation("horizontal")}
          />
          <IconButton
            icon="ph:rows"
            size="sm"
            active={layoutOrientation === "vertical"}
            className={`flow-canvas-tool flow-canvas-layout-tool${layoutOrientation === "vertical" ? " is-active" : ""}`}
            aria-pressed={layoutOrientation === "vertical"}
            aria-label="Use vertical layout"
            title="Use vertical layout"
            onClick={() => props.onLayoutOrientation("vertical")}
          />
        </div>
        <IconButton
          icon="ph:squares-four"
          size="sm"
          className="flow-canvas-tool"
          onClick={props.onTidy}
          title="Tidy up workflow"
          aria-label="Tidy up workflow"
        />
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
