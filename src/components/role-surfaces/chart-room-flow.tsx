"use client";

/**
 * chart-room-flow — the Flow lens.
 *
 * The board's lanes as columns, with the operator's dependency chart drawn
 * over them: an elbow from what a step waits on to the step itself, a dotted
 * arc when that edge runs backwards, and amber when the thing being waited on
 * is late. Hovering a step lights its whole route and fades the rest.
 *
 * The right-edge port drags a new dependency onto whatever waits on this step.
 */

import { type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/lib/icon";
import { ChartDot, StateTag } from "./chart-room-parts";
import type { ChartStageId, ChartStep, FlowLayout } from "./chart-room-model";
import { stepRecommendation } from "./chart-room-model";

export type FlowDrag = { from: string; x: number; y: number };

export function ChartRoomFlow({
  steps,
  layout,
  columnWidth,
  nodeHeight,
  expandedHeight,
  selectedId,
  expanded,
  drag,
  routeIds,
  canvasRef,
  ownerName,
  projectColor,
  projectName,
  onSelect,
  onHover,
  onToggleExpanded,
  onPortDown,
  onAddStep,
  addPending,
}: {
  steps: readonly ChartStep[];
  layout: FlowLayout;
  columnWidth: number;
  nodeHeight: number;
  expandedHeight: number;
  selectedId: string | null;
  expanded: ReadonlySet<string>;
  drag: FlowDrag | null;
  /** The lit route, or null when nothing is hovered or selected. */
  routeIds: ReadonlySet<string> | null;
  canvasRef: (node: HTMLDivElement | null) => void;
  ownerName: (id: string | null) => string;
  projectColor: (id: string | null) => string | null;
  projectName: (id: string | null) => string;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onToggleExpanded: (id: string) => void;
  onPortDown: (id: string, event: ReactPointerEvent<HTMLSpanElement>) => void;
  onAddStep: (stage: ChartStageId) => void;
  addPending: boolean;
}) {
  const columnStyle = { "--cr-col-w": `${columnWidth}px` } as CSSProperties;
  const dragEdge = drag ? layout.positions[drag.from] : null;

  return (
    <>
      <div className="cr-flow__heads">
        {layout.columns.map((column) => (
          <div
            key={column.stage.id}
            className="cr-flow__head"
            style={columnStyle}
            data-filled={column.steps.length > 0}
          >
            <span className="cr-eyebrow">{column.stage.name}</span>
            <span className="cr-mono">{column.steps.length}</span>
            <span className="cr-lens__spacer" />
            <button
              type="button"
              className="cr-icon-btn focus-ring"
              title={`Chart a step in ${column.stage.name}`}
              aria-label={`Chart a step in ${column.stage.name}`}
              disabled={addPending}
              onClick={() => onAddStep(column.stage.id)}
            >
              <Icon name="ph:plus" width={11} height={11} aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="cr-flow__canvas" ref={canvasRef}>
        <svg
          className="cr-flow__edges"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          fill="none"
          aria-hidden
        >
          {layout.edges.map((edge) => (
            <path
              key={edge.id}
              className="cr-edge"
              data-tone={edge.tone}
              d={edge.d}
              strokeWidth={edge.lit ? 2.2 : 1.6}
              strokeLinecap="round"
              strokeDasharray={edge.tone === "late" ? "5 4" : edge.tone === "backwards" ? "2 4" : undefined}
              fill="none"
            />
          ))}
          {layout.edges.map((edge) => (
            <circle key={`${edge.id}-dot`} className="cr-edge-dot" data-tone={edge.tone} cx={edge.dotX} cy={edge.dotY} r={3} />
          ))}
          {dragEdge && drag ? (
            <>
              <path
                className="cr-edge"
                data-tone="live"
                d={`M${dragEdge.right} ${dragEdge.y} C${dragEdge.right + 60} ${dragEdge.y}, ${drag.x - 60} ${drag.y}, ${drag.x} ${drag.y}`}
                strokeWidth={1.8}
                strokeDasharray="5 4"
                fill="none"
              />
              <circle className="cr-edge-dot" data-tone="live" cx={drag.x} cy={drag.y} r={3} />
            </>
          ) : null}
        </svg>

        <div className="cr-flow__cols">
          {layout.columns.map((column) => (
            <ul key={column.stage.id} className="cr-flow__col" style={columnStyle}>
              {column.steps.map((step) => {
                const isExpanded = expanded.has(step.id);
                const isTarget = drag != null && drag.from !== step.id;
                const upstream = step.needs ? steps.find((other) => other.id === step.needs) : undefined;
                const waiting = steps.filter((other) => other.needs === step.id).length;
                const recommendation = isExpanded ? stepRecommendation(step, steps) : null;
                return (
                  <li key={step.id}>
                    <div
                      data-step-id={step.id}
                      className="cr-node"
                      style={
                        {
                          "--cr-node-h": `${isExpanded ? expandedHeight : nodeHeight}px`,
                        } as CSSProperties
                      }
                      data-selected={step.id === selectedId}
                      data-target={isTarget}
                      data-off-route={routeIds != null && !routeIds.has(step.id)}
                      onMouseEnter={() => {
                        if (!drag) onHover(step.id);
                      }}
                      onMouseLeave={() => onHover(null)}
                    >
                      <span
                        className="cr-node__port cr-node__port--in"
                        data-linked={upstream != null || isTarget}
                        aria-hidden
                      />
                      <span
                        className="cr-node__port cr-node__port--out"
                        data-dragging={drag?.from === step.id}
                        title="Drag onto the step that waits on this one"
                        onPointerDown={(event) => onPortDown(step.id, event)}
                      />
                      <button
                        type="button"
                        className="cr-node__open focus-ring-inset"
                        onClick={() => onSelect(step.id)}
                      >
                        <span className="cr-node__top">
                          <ChartDot color={projectColor(step.project)} />
                          <span className="cr-mono">{projectName(step.project)}</span>
                          <StateTag state={step.state} />
                          <span className="cr-mono">{ownerName(step.owner)}</span>
                        </span>
                        <span className="cr-node__title">{step.title}</span>
                        <span className="cr-node__foot">
                          {upstream ? (
                            <span className="cr-node__need">
                              <Icon name="ph:arrow-bend-left-up" width={10} height={10} aria-hidden />
                              <span>waits on {upstream.title}</span>
                            </span>
                          ) : null}
                          <span>{waiting > 0 ? `${waiting} waiting` : ""}</span>
                        </span>
                      </button>
                      {isExpanded && recommendation ? (
                        <div className="cr-node__rec">
                          <span className="cr-node__rec-line">{recommendation.text}</span>
                          <span className="cr-node__foot">
                            <Icon name="ph:arrow-bend-right-down" width={10} height={10} aria-hidden />
                            <span>
                              {waiting > 0
                                ? `${waiting} step${waiting > 1 ? "s" : ""} wait on this`
                                : "nothing waits on this"}
                            </span>
                          </span>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="cr-node__more focus-ring"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Hide" : "Show"} what to do with ${step.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleExpanded(step.id);
                        }}
                      >
                        {isExpanded ? "less" : "more"}
                        <Icon name={isExpanded ? "ph:caret-up" : "ph:caret-down"} width={9} height={9} aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className="cr-flow__add focus-ring"
                  disabled={addPending}
                  onClick={() => onAddStep(column.stage.id)}
                >
                  <Icon name="ph:plus" width={11} height={11} aria-hidden /> Step
                </button>
              </li>
            </ul>
          ))}
        </div>
      </div>
    </>
  );
}
