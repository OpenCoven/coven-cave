"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export type FlowEdgeData = {
  /** Open the node catalog to splice a node into this edge. */
  onInsert?: () => void;
} & Record<string, unknown>;

export type FlowRFEdge = Edge<FlowEdgeData, "flowEdge">;

/**
 * Smoothstep edge with an n8n-style "+" button at its midpoint. Clicking it
 * asks the editor to splice a new node into the connection (A→B → A→new→B).
 */
export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<FlowRFEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      {data?.onInsert && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="flow-edge-add nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            title="Insert a node here"
            aria-label="Insert a node on this connection"
            onClick={(event) => {
              event.stopPropagation();
              data.onInsert?.();
            }}
          >
            +
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
