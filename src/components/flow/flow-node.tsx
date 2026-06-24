"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Icon } from "@/lib/icon";
import type { FlowNodeType } from "@/lib/flow/flow-catalog";
import type { FlowNode } from "@/lib/flow/flow-doc";
import type { FlowNodePhase } from "@/lib/flow/flow-progress";

/** Live run phase overlaid by the canvas while an execution/preview walks. */
export type { FlowNodePhase };

export type FlowNodeData = {
  node: FlowNode;
  def: FlowNodeType | undefined;
  phase?: FlowNodePhase;
} & Record<string, unknown>;

export type FlowRFNode = Node<FlowNodeData, "flowNode">;
export type FlowStickyRFNode = Node<FlowNodeData, "flowSticky">;

export const FLOW_NODE_WIDTH = 220;
export const FLOW_NODE_HEIGHT = 78;

function handleTop(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

/** The n8n-style node card: icon tile, name, type subtitle, port handles. */
export function FlowNodeView({ data, selected }: NodeProps<FlowRFNode>) {
  const { node, def, phase } = data;
  const accent = def?.accent ?? "#7b7f87";
  const inputs = def?.inputs ?? [];
  const outputs = def?.outputs ?? [];
  const isTrigger = def?.isTrigger === true;
  const classes = [
    "flow-node",
    `flow-node-${def?.category ?? "unknown"}`,
    isTrigger ? "flow-node-trigger" : "",
    node.disabled ? "is-disabled" : "",
    phase ? `flow-node-phase-${phase}` : "",
    selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={{ width: FLOW_NODE_WIDTH }}>
      {inputs.map((port, index) => (
        <Handle
          key={`in-${port.id}`}
          id={port.id}
          type="target"
          position={Position.Left}
          className="flow-handle flow-handle-in"
          style={{ top: handleTop(index, inputs.length) }}
        />
      ))}

      <span className="flow-node-icon" style={{ background: accent }} aria-hidden>
        <Icon name={def?.icon ?? "ph:cube"} width={18} />
      </span>
      <span className="flow-node-body">
        <span className="flow-node-name" title={node.name}>
          {node.name}
        </span>
        <span className="flow-node-type">{def?.label ?? node.type}</span>
      </span>

      {node.disabled && <span className="flow-node-disabled-badge">disabled</span>}
      {phase && (
        <span className={`flow-node-phase-dot flow-node-phase-dot-${phase}`} aria-label={phase}>
          {phase === "running" && <span className="flow-node-spinner" aria-hidden />}
        </span>
      )}

      {outputs.map((port, index) => (
        <span key={`out-${port.id}`} className="flow-out" style={{ top: handleTop(index, outputs.length) }}>
          {outputs.length > 1 && port.label && <span className="flow-out-label">{port.label}</span>}
          <Handle
            id={port.id}
            type="source"
            position={Position.Right}
            className="flow-handle flow-handle-out"
          />
        </span>
      ))}
    </div>
  );
}

/** Sticky note — a non-executable canvas annotation. */
export function FlowStickyView({ data, selected }: NodeProps<FlowStickyRFNode>) {
  const sticky = data.node.sticky;
  if (!sticky) return null;
  return (
    <div
      className={`flow-sticky flow-sticky-${sticky.color}${selected ? " is-selected" : ""}`}
      style={{ width: sticky.width, height: sticky.height }}
    >
      <span className="flow-sticky-grip" aria-hidden>
        <Icon name="ph:note" width={13} />
      </span>
      <p className="flow-sticky-text">{sticky.text || "Double-click to edit"}</p>
    </div>
  );
}
