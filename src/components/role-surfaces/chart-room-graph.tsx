"use client";

/**
 * chart-room-graph — the Graph lens.
 *
 * Laid out by dependency depth rather than by lane: column one is everything
 * that can start today, and a node always sits to the right of whatever it
 * waits on. Stage cannot do that job — two cards in the same lane can be a
 * week apart when one waits on the other.
 *
 * A click here traces; it does not open. The chain strip above is the drilldown.
 */

import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback } from "react";
import { Icon } from "@/lib/icon";
import { ChartDot, StateTag } from "./chart-room-parts";
import type { ChartStep, GraphLayout } from "./chart-room-model";

export type RouteVisibility = "dim" | "hide" | "show";

export function ChartRoomGraph({
  steps,
  layout,
  selectedId,
  chain,
  routeVisibility,
  zoom,
  pan,
  panning,
  nodeHeight,
  ownerName,
  projectColor,
  projectName,
  onTrace,
  onPanStart,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  steps: readonly ChartStep[];
  layout: GraphLayout;
  selectedId: string | null;
  chain: ReadonlySet<string>;
  routeVisibility: RouteVisibility;
  zoom: number;
  pan: { x: number; y: number };
  panning: boolean;
  nodeHeight: number;
  ownerName: (id: string | null) => string;
  projectColor: (id: string | null) => string | null;
  projectName: (id: string | null) => string;
  onTrace: (id: string) => void;
  onPanStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const offRoute = useCallback(
    (id: string): RouteVisibility | undefined => {
      if (selectedId == null || chain.has(id)) return undefined;
      return routeVisibility === "show" ? undefined : routeVisibility;
    },
    [chain, routeVisibility, selectedId],
  );

  return (
    <div
      className="cr-graph"
      data-panning={panning}
      onPointerDown={onPanStart}
      role="presentation"
    >
      <div
        className="cr-graph__canvas"
        style={
          {
            "--cr-w": `${layout.width}px`,
            "--cr-h": `${layout.height}px`,
            "--cr-pan-x": `${pan.x + 24}px`,
            "--cr-pan-y": `${pan.y + 18}px`,
            "--cr-zoom": String(zoom),
          } as CSSProperties
        }
      >
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          fill="none"
          className="cr-flow__edges"
          aria-hidden
        >
          {layout.edges.map((edge) => {
            const dim = selectedId != null && !edge.lit && routeVisibility !== "show";
            if (dim && routeVisibility === "hide") return null;
            return (
              <g key={edge.id} className="cr-graph__edge" data-off-route={dim}>
                <path
                  className="cr-edge"
                  data-tone={edge.tone}
                  d={edge.d}
                  strokeWidth={edge.lit ? 2.2 : 1.5}
                  strokeDasharray={edge.tone === "backwards" ? "2 5" : edge.lit ? "8 6" : undefined}
                  fill="none"
                />
                {edge.arrow ? <path className="cr-edge-dot" data-tone={edge.tone} d={edge.arrow} /> : null}
              </g>
            );
          })}
        </svg>

        {steps.map((step) => {
          const at = layout.positions[step.id];
          if (!at) return null;
          const fan = steps.filter((other) => other.needs === step.id).length;
          return (
            <button
              key={step.id}
              type="button"
              className="cr-graph__node focus-ring"
              aria-pressed={step.id === selectedId}
              data-off-route={offRoute(step.id)}
              style={
                {
                  "--cr-x": `${at.x}px`,
                  "--cr-y": `${at.y}px`,
                  ...(projectColor(step.project) ? { "--cr-dot": projectColor(step.project) as string } : {}),
                } as CSSProperties
              }
              onClick={() => onTrace(step.id)}
            >
              <span className="cr-node__top">
                <ChartDot color={projectColor(step.project)} />
                <span className="cr-mono">{projectName(step.project)}</span>
                <StateTag state={step.state} />
              </span>
              <span className="cr-node__title">{step.title}</span>
              <span className="cr-node__foot">
                <span className="cr-mono">{ownerName(step.owner)}</span>
                <span>{fan > 0 ? `${fan} waiting` : ""}</span>
              </span>
            </button>
          );
        })}

        {layout.rankLabels.map((rank) => (
          <span
            key={rank.depth}
            className="cr-graph__rank"
            style={
              {
                "--cr-x": `${rank.x}px`,
                "--cr-rank-y": `${layout.height - nodeHeight / 4}px`,
              } as CSSProperties
            }
          >
            {rank.label}
          </span>
        ))}
      </div>

      <div className="cr-graph__zoom">
        <button type="button" className="cr-icon-btn focus-ring" aria-label="Zoom out" onClick={onZoomOut}>
          <Icon name="ph:minus" width={11} height={11} aria-hidden />
        </button>
        <span className="cr-mono">{Math.round(zoom * 100)}%</span>
        <button type="button" className="cr-icon-btn focus-ring" aria-label="Zoom in" onClick={onZoomIn}>
          <Icon name="ph:plus" width={11} height={11} aria-hidden />
        </button>
        <button type="button" className="cr-btn cr-btn--quiet focus-ring" onClick={onFit}>
          Fit
        </button>
      </div>
    </div>
  );
}
