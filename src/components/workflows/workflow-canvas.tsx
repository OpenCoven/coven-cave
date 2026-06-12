"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useMemo } from "react";
import { workflowToGraph, type WorkflowGraphNode, type WorkflowGraphNodeData } from "@/lib/workflow-graph";
import type { WorkflowDryRunPlan, WorkflowSummary } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

type WorkflowFlowNode = Node<WorkflowGraphNodeData & Record<string, unknown>, "workflowStep">;

type WorkflowCanvasProps = {
  workflow: WorkflowSummary | null;
  action: WorkflowStudioActionState | null;
  selectedNode: WorkflowGraphNode | null;
  onSelectNode: (node: WorkflowGraphNode) => void;
  onClearNode: () => void;
  onConnect: (source: string, target: string) => void;
  onDisconnect: (source: string, target: string) => void;
  onRemoveStep: (id: string) => void;
};

export function WorkflowStepNode({ data, selected }: NodeProps<WorkflowFlowNode>) {
  return (
    <div className={`workflow-node workflow-node-${data.tone}${selected ? " is-selected" : ""}`}>
      <div className="workflow-node-kind">{data.kind}</div>
      <div className="workflow-node-label">{data.label}</div>
      {data.uses && <div className="workflow-node-uses">{data.uses}</div>}
      {data.status && <div className={`workflow-node-status workflow-node-status-${data.status}`}>{data.status}</div>}
    </div>
  );
}

export const nodeTypes: NodeTypes = { workflowStep: WorkflowStepNode };

function dryRunFromAction(action: WorkflowStudioActionState | null): WorkflowDryRunPlan | undefined {
  if (action?.kind !== "dry-run") return undefined;
  return action.result as WorkflowDryRunPlan;
}

function toFlowNode(node: WorkflowGraphNode, selectedNode: WorkflowGraphNode | null): WorkflowFlowNode {
  return {
    ...node,
    selected: selectedNode?.id === node.id,
    data: { ...node.data },
  };
}

export function WorkflowCanvas({
  workflow,
  action,
  selectedNode,
  onSelectNode,
  onClearNode,
  onConnect,
  onDisconnect,
  onRemoveStep,
}: WorkflowCanvasProps) {
  const graph = useMemo(() => {
    if (!workflow) return { nodes: [] as WorkflowGraphNode[], edges: [] as Edge[] };
    return workflowToGraph(workflow, dryRunFromAction(action));
  }, [action, workflow]);

  const nodes = useMemo(() => graph.nodes.map((node) => toFlowNode(node, selectedNode)), [graph.nodes, selectedNode]);
  const edges = graph.edges as Edge[];

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

  return (
    <section className="workflow-canvas" aria-label={`${workflow.name ?? workflow.id} graph`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={handleNodeClick}
        onPaneClick={onClearNode}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        onNodesDelete={handleNodesDelete}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
