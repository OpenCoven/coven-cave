"use client";

import "@xyflow/react/dist/style.css";

import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  workflowToGraph,
  type WorkflowGraphNode,
  type WorkflowGraphNodeData,
  type WorkflowLayoutDirection,
  type WorkflowNodePositions,
} from "@/lib/workflow-graph";
import {
  activeStepId,
  nodePhases,
  type WorkflowPlaybackState,
} from "@/lib/workflow-playback";
import type { WorkflowDryRunPlan, WorkflowSummary } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

type WorkflowFlowNode = Node<WorkflowGraphNodeData & Record<string, unknown>, "workflowStep">;
const WORKFLOW_NODE_WIDTH = 172;
const WORKFLOW_NODE_HEIGHT = 74;

type WorkflowCanvasProps = {
  workflow: WorkflowSummary | null;
  action: WorkflowStudioActionState | null;
  selectedNode: WorkflowGraphNode | null;
  savedPositions: WorkflowNodePositions | null;
  layoutDirection: WorkflowLayoutDirection;
  viewResetKey: number;
  playback: WorkflowPlaybackState | null;
  onSelectNode: (node: WorkflowGraphNode) => void;
  onClearNode: () => void;
  onResetView: () => void;
  onSwitchLayout: () => void;
  onConnect: (source: string, target: string) => void;
  onDisconnect: (source: string, target: string) => void;
  onRemoveStep: (id: string) => void;
  onSavePositions: (positions: WorkflowNodePositions) => void;
};

const PHASE_LABEL: Record<NonNullable<WorkflowGraphNodeData["phase"]>, string> = {
  pending: "queued",
  active: "running",
  done: "done",
  blocked: "blocked",
};

export function WorkflowStepNode({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const phaseClass = data.phase ? ` workflow-node-phase-${data.phase}` : "";
  const layoutDirection = data.layoutDirection === "vertical" ? "vertical" : "horizontal";
  return (
    <div className={`workflow-node workflow-node-${data.tone}${phaseClass}${selected ? " is-selected" : ""}`}>
      {/* Connection points React Flow attaches edges to. The layered layout runs
          left→right by dependency depth, so dependencies enter on the left
          (target) and continue on the right (source). Without these handles
          every edge fails with error #008 and no graph connections render. */}
      <Handle type="target" position={layoutDirection === "vertical" ? Position.Top : Position.Left} />
      <div className="workflow-node-kind">{data.kind}</div>
      <div className="workflow-node-label">{data.label}</div>
      {data.uses && <div className="workflow-node-uses">{data.uses}</div>}
      {/* During playback the live phase wins the status slot; otherwise the
          dry-run ready/blocked verdict shows. */}
      {data.phase ? (
        <div className={`workflow-node-status workflow-node-phase-pill workflow-node-phase-pill-${data.phase}`}>
          {data.phase === "active" && <span className="workflow-node-phase-spinner" aria-hidden />}
          {PHASE_LABEL[data.phase]}
        </div>
      ) : (
        data.status && (
          <div className={`workflow-node-status workflow-node-status-${data.status}`}>{data.status}</div>
        )
      )}
      <Handle type="source" position={layoutDirection === "vertical" ? Position.Bottom : Position.Right} />
    </div>
  );
}

export const nodeTypes: NodeTypes = { workflowStep: WorkflowStepNode };

function dryRunFromAction(action: WorkflowStudioActionState | null): WorkflowDryRunPlan | undefined {
  if (action?.kind !== "dry-run") return undefined;
  return action.result as WorkflowDryRunPlan;
}

function workflowMiniMapNodeColor(node: Node): string {
  const data = node.data as Partial<WorkflowGraphNodeData> | undefined;
  if (data?.status === "blocked") return "#b95050";
  if (data?.status === "ready") return "#3f8f5b";
  if (data?.tone === "input") return "#4f9d69";
  if (data?.tone === "agent") return "#6b8fbf";
  if (data?.tone === "gate") return "#b5892f";
  if (data?.tone === "tool") return "#7c9b70";
  if (data?.tone === "workflow") return "#9b7cb7";
  if (data?.tone === "output") return "#5f9ea0";
  return "#7b7f87";
}

export function WorkflowCanvas({
  workflow,
  action,
  selectedNode,
  savedPositions,
  layoutDirection,
  viewResetKey,
  playback,
  onSelectNode,
  onClearNode,
  onResetView,
  onSwitchLayout,
  onConnect,
  onDisconnect,
  onRemoveStep,
  onSavePositions,
}: WorkflowCanvasProps) {
  const [showMiniMap, setShowMiniMap] = useState(false);
  // Playback overlay: the active step id + per-node phase map drive node glow
  // and edge highlighting. Null when nothing is playing.
  const playbackPhases = useMemo(() => (playback ? nodePhases(playback) : null), [playback]);
  const playbackActiveId = useMemo(() => (playback ? activeStepId(playback) : null), [playback]);
  const graph = useMemo(() => {
    if (!workflow) return { nodes: [] as WorkflowGraphNode[], edges: [] };
    return workflowToGraph(workflow, dryRunFromAction(action), savedPositions, layoutDirection);
  }, [action, layoutDirection, savedPositions, workflow]);

  // Nodes live in local state so drags are interactive — a fully-controlled
  // graph snaps nodes back on the next render. The graph model stays the
  // source of truth for structure; local state only owns positions while a
  // workflow is mounted.
  const [nodes, setNodes] = useState<WorkflowFlowNode[]>([]);
  const nodesRef = useRef<WorkflowFlowNode[]>([]);
  const mountedGraphKey = useRef<string | null>(null);

  useEffect(() => {
    setNodes((current) => {
      const graphKey = `${workflow?.id ?? "none"}:${layoutDirection}:${viewResetKey}`;
      const sameWorkflow = mountedGraphKey.current === graphKey;
      mountedGraphKey.current = graphKey;
      const livePositions = new Map(current.map((node) => [node.id, node.position]));
      const next = graph.nodes.map(
        (node): WorkflowFlowNode => ({
          ...node,
          // Structure edits (add/remove/rename/undo) keep in-flight drag
          // positions for surviving nodes; switching workflows reseeds fully.
          position: (sameWorkflow ? livePositions.get(node.id) : undefined) ?? node.position,
          initialWidth: WORKFLOW_NODE_WIDTH,
          initialHeight: WORKFLOW_NODE_HEIGHT,
          data: { ...node.data, layoutDirection },
        }),
      );
      nodesRef.current = next;
      return next;
    });
  }, [graph, layoutDirection, viewResetKey, workflow?.id]);

  const renderNodes = useMemo(
    () =>
      nodes.map((node) => {
        const phase = playbackPhases?.[node.id];
        return {
          ...node,
          selected: selectedNode?.id === node.id,
          data: phase ? { ...node.data, phase } : node.data,
        };
      }),
    [nodes, playbackPhases, selectedNode],
  );

  // Smoothstep + arrowheads so dependency direction reads on the dark canvas.
  // During playback, the edge feeding the active step pulses; edges whose
  // target has already resolved read as traversed.
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => {
        const targetPhase = playbackPhases?.[edge.target];
        const isActiveEdge = playbackActiveId !== null && edge.target === playbackActiveId;
        const isTraversed = targetPhase === "done" || targetPhase === "blocked";
        return {
          ...edge,
          type: "smoothstep",
          animated: isActiveEdge || edge.animated,
          className: isActiveEdge
            ? "workflow-edge-active"
            : isTraversed
              ? "workflow-edge-traversed"
              : undefined,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: isActiveEdge ? "#d8c98f" : "#9a8ecd",
          },
        };
      }),
    [graph.edges, playbackActiveId, playbackPhases],
  );

  const handleNodesChange = (changes: NodeChange<WorkflowFlowNode>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      nodesRef.current = next;
      return next;
    });
  };

  const handleNodeDragStop = () => {
    onSavePositions(
      Object.fromEntries(nodesRef.current.map((node) => [node.id, node.position])),
    );
  };

  const handleNodeClick: NodeMouseHandler<WorkflowFlowNode> = (_event, node) => {
    onSelectNode({
      id: node.id,
      type: "workflowStep",
      position: node.position,
      data: node.data,
    });
  };

  // Drawing source→target on the canvas means "target requires source".
  const handleConnect = (connection: Connection) => {
    if (connection.source && connection.target) {
      onConnect(connection.source, connection.target);
    }
  };

  const handleEdgesDelete = (deleted: Edge[]) => {
    for (const edge of deleted) {
      onDisconnect(edge.source, edge.target);
    }
  };

  const handleNodesDelete = (deleted: WorkflowFlowNode[]) => {
    for (const node of deleted) {
      onRemoveStep(node.id);
    }
  };

  if (!workflow) {
    return (
      <section className="workflow-canvas workflow-canvas-empty" aria-label="Workflow canvas">
        <p>Select a workflow to preview its graph.</p>
      </section>
    );
  }

  const flowKey = `${workflow.id}:${layoutDirection}:${viewResetKey}`;

  return (
    <section className="workflow-canvas" aria-label={`${workflow.name ?? workflow.id} graph`}>
      <div className="workflow-canvas-toolbar" aria-label="Workflow canvas actions">
        <button
          type="button"
          className="workflow-canvas-tool"
          aria-label="Reset workflow view"
          title="Reset workflow view"
          onClick={onResetView}
        >
          <Icon name="ph:arrow-counter-clockwise" width={14} />
        </button>
        <button
          type="button"
          className="workflow-canvas-tool"
          aria-label={layoutDirection === "horizontal" ? "Switch workflow layout to vertical" : "Switch workflow layout to horizontal"}
          title={layoutDirection === "horizontal" ? "Switch layout to vertical" : "Switch layout to horizontal"}
          onClick={onSwitchLayout}
        >
          <Icon name={layoutDirection === "horizontal" ? "ph:rows" : "ph:columns"} width={14} />
        </button>
        <button
          type="button"
          className={`workflow-canvas-tool workflow-minimap-toggle${showMiniMap ? " is-active" : ""}`}
          aria-label={showMiniMap ? "Hide workflow minimap" : "Show workflow minimap"}
          aria-pressed={showMiniMap}
          title={showMiniMap ? "Hide workflow minimap" : "Show workflow minimap"}
          onClick={() => setShowMiniMap((visible) => !visible)}
        >
          <Icon name="ph:graph" width={14} />
        </button>
      </div>
      <ReactFlow
        key={flowKey}
        nodes={renderNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onPaneClick={onClearNode}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        onNodesDelete={handleNodesDelete}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        {showMiniMap && (
          <MiniMap
            zoomable
            pannable
            position="bottom-right"
            nodeColor={workflowMiniMapNodeColor}
            nodeStrokeWidth={3}
            nodeBorderRadius={6}
            maskColor="rgb(0 0 0 / 48%)"
            bgColor="var(--card)"
            style={{ width: 180, height: 118 }}
          />
        )}
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
