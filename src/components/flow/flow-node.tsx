"use client";

import { Handle, NodeResizer, Position, type NodeProps, type Node } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { FlowNodeType } from "@/lib/flow/flow-catalog";
import type { FlowLayoutOrientation, FlowNode } from "@/lib/flow/flow-doc";
import type { FlowNodePhase } from "@/lib/flow/flow-progress";

/** Live run phase overlaid by the canvas while an execution/preview walks. */
export type { FlowNodePhase };

export type FlowNodeData = {
  node: FlowNode;
  def: FlowNodeType | undefined;
  phase?: FlowNodePhase;
  stale?: boolean;
  /** Canvas layout direction — flips port handles between the side and top/bottom edges. */
  orientation?: FlowLayoutOrientation;
  /** Sticky-only: commit inline-edited text / resized dimensions to the doc. */
  onStickyText?: (text: string) => void;
  onStickySize?: (width: number, height: number) => void;
} & Record<string, unknown>;

export type FlowRFNode = Node<FlowNodeData, "flowNode">;
export type FlowStickyRFNode = Node<FlowNodeData, "flowSticky">;

export const FLOW_NODE_WIDTH = 220;
export const FLOW_NODE_HEIGHT = 78;

/** Even spacing for the nth of `count` ports along a node edge (0–100%). */
function handleOffset(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

/** The n8n-style node card: icon tile, name, type subtitle, port handles. */
function FlowNodeViewImpl({ data, selected }: NodeProps<FlowRFNode>) {
  const { node, def, phase, stale, orientation } = data;
  const accent = def?.accent ?? "#7b7f87";
  const inputs = def?.inputs ?? [];
  const outputs = def?.outputs ?? [];
  const isTrigger = def?.isTrigger === true;
  // Vertical layouts flow top→bottom, so ports live on the top/bottom edges and
  // spread along the X axis; horizontal layouts keep them left/right on the Y axis.
  const isVertical = orientation === "vertical";
  const inputPosition = isVertical ? Position.Top : Position.Left;
  const outputPosition = isVertical ? Position.Bottom : Position.Right;
  const displayedNote = node.displayNote ? node.notes?.trim() : "";
  const classes = [
    "flow-node",
    `flow-node-${def?.category ?? "unknown"}`,
    isTrigger ? "flow-node-trigger" : "",
    node.disabled ? "is-disabled" : "",
    stale ? "is-stale" : "",
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
          position={inputPosition}
          className="flow-handle flow-handle-in"
          style={isVertical ? { left: handleOffset(index, inputs.length) } : { top: handleOffset(index, inputs.length) }}
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
        {displayedNote && (
          <span className="flow-node-note-text" title={displayedNote}>
            {displayedNote}
          </span>
        )}
      </span>

      {node.disabled && (
        <span className="flow-node-disabled-badge" aria-label="Disabled">
          disabled
        </span>
      )}
      {node.requiredParams && node.requiredParams.length > 0 && (
        <span
          className="flow-node-required-badge"
          aria-label="Requires input"
          title="Requires input before running"
        >
          *required
        </span>
      )}
      {stale && (
        <span className="flow-node-stale-badge" aria-label="Stale data" title="Node data is stale">
          <Icon name="ph:warning" width={13} />
        </span>
      )}
      {phase && (
        <span className={`flow-node-phase-dot flow-node-phase-dot-${phase}`} aria-label={phase}>
          {phase === "running" && <span className="flow-node-spinner" aria-hidden />}
        </span>
      )}

      {outputs.map((port, index) => (
        <span
          key={`out-${port.id}`}
          className={`flow-out${isVertical ? " flow-out-vertical" : ""}`}
          style={isVertical ? { left: handleOffset(index, outputs.length) } : { top: handleOffset(index, outputs.length) }}
        >
          {outputs.length > 1 && port.label && <span className="flow-out-label">{port.label}</span>}
          <Handle
            id={port.id}
            type="source"
            position={outputPosition}
            className="flow-handle flow-handle-out"
          />
        </span>
      ))}
    </div>
  );
}

/** Sticky note — a non-executable canvas annotation. Double-click to edit its
 *  text inline; drag the corner handles (when selected) to resize. */
function FlowStickyViewImpl({ data, selected }: NodeProps<FlowStickyRFNode>) {
  const sticky = data.node.sticky;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sticky?.text ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Re-seed the draft from the doc whenever we're not actively editing.
  useEffect(() => {
    if (!editing) setDraft(sticky?.text ?? "");
  }, [sticky?.text, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  if (!sticky) return null;

  const commit = () => {
    setEditing(false);
    if (draft !== sticky.text) data.onStickyText?.(draft);
  };

  return (
    <div
      className={`flow-sticky flow-sticky-${sticky.color}${selected ? " is-selected" : ""}`}
      style={{ width: "100%", height: "100%" }}
      onDoubleClick={() => setEditing(true)}
    >
      <NodeResizer
        minWidth={150}
        minHeight={90}
        isVisible={selected}
        lineClassName="flow-sticky-resize-line"
        handleClassName="flow-sticky-resize-handle"
        onResizeEnd={(_event, params) =>
          data.onStickySize?.(Math.round(params.width), Math.round(params.height))
        }
      />
      <span className="flow-sticky-grip" aria-hidden>
        <Icon name="ph:note" width={13} />
      </span>
      {editing ? (
        <textarea
          ref={textareaRef}
          className="flow-sticky-input nodrag nopan"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          // Stop key events reaching React Flow so Backspace/Delete edit text
          // instead of deleting the node.
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setDraft(sticky.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <p className="flow-sticky-text">{sticky.text || "Double-click to edit"}</p>
      )}
    </div>
  );
}

// Memoized so an unrelated FlowView re-render (a run tick, a notice, a
// keystroke in the detail panel) doesn't re-render every node card — only nodes
// whose `data`/`selected` actually changed. Relies on the canvas keeping node
// `data` identities stable (see the stabilized sticky callbacks in flow-view).
export const FlowNodeView = memo(FlowNodeViewImpl);
export const FlowStickyView = memo(FlowStickyViewImpl);
