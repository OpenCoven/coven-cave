"use client";

/**
 * chart-room-chain — the selected step's whole route, root first.
 *
 * Two readings of the same thing: the strip is the route as a sentence, the
 * diagram is the connected component around the selection, so branches the
 * linear strip flattens stay visible. A chain of one is not a route, so the
 * caller does not render this at all below two steps.
 */

import type { CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { chainHold, stageName, type ChartStep } from "./chart-room-model";

export type ChainShape = "strip" | "diagram";

type Standing = "done" | "cleared" | "hold" | "ahead";

function standingOf(step: ChartStep, index: number, hold: number): Standing {
  if (step.state === "done") return "done";
  if (index === hold) return "hold";
  if (hold >= 0 && index < hold) return "cleared";
  return "ahead";
}

const NOTE: Record<Standing, string> = {
  done: "landed",
  cleared: "cleared",
  hold: "everything after waits here",
  ahead: "not started",
};

export function ChartRoomChain({
  chain,
  component,
  shape,
  selectedId,
  summary,
  projectColor,
  onShape,
  onSelect,
  onOpenStep,
  onClose,
}: {
  chain: readonly ChartStep[];
  /** The connected component around the selection, laid out for the diagram. */
  component: {
    width: number;
    height: number;
    nodes: Array<{ step: ChartStep; x: number; y: number }>;
    edges: Array<{ id: string; d: string; hot: boolean }>;
  };
  shape: ChainShape;
  selectedId: string | null;
  summary: string;
  projectColor: (id: string | null) => string | null;
  onShape: (next: ChainShape) => void;
  onSelect: (id: string) => void;
  onOpenStep: () => void;
  onClose: () => void;
}) {
  const hold = chainHold(chain);
  const heldId = hold >= 0 ? chain[hold]?.id : undefined;

  return (
    <div className="cr-chain">
      <div className="cr-chain__head">
        <Icon name="ph:steps" width={13} height={13} aria-hidden />
        <span className="cr-eyebrow cr-eyebrow--accent">Chain</span>
        <span className="cr-chain__summary">{summary}</span>
        <span className="cr-seg">
          <button
            type="button"
            className="cr-seg__btn focus-ring"
            aria-pressed={shape === "strip"}
            title="The route as an ordered list, root first"
            onClick={() => onShape("strip")}
          >
            <Icon name="ph:list-numbers" width={10} height={10} aria-hidden /> Steps
          </button>
          <button
            type="button"
            className="cr-seg__btn focus-ring"
            aria-pressed={shape === "diagram"}
            title="The same work as a flow diagram, branches and all"
            onClick={() => onShape("diagram")}
          >
            <Icon name="ph:graph" width={10} height={10} aria-hidden /> Diagram
          </button>
        </span>
        <button type="button" className="cr-btn focus-ring" onClick={onOpenStep}>
          <Icon name="ph:arrows-out-simple" width={10} height={10} aria-hidden /> Open step
        </button>
        <button
          type="button"
          className="cr-icon-btn focus-ring"
          aria-label="Close the chain breakdown"
          onClick={onClose}
        >
          <Icon name="ph:x" width={11} height={11} aria-hidden />
        </button>
      </div>

      {shape === "diagram" ? (
        <div className="cr-chain__diagram-scroll">
          <div
            className="cr-chain__diagram"
            style={{ "--cr-w": `${component.width}px`, "--cr-h": `${component.height}px` } as CSSProperties}
          >
            <svg
              className="cr-flow__edges"
              width={component.width}
              height={component.height}
              viewBox={`0 0 ${component.width} ${component.height}`}
              fill="none"
              aria-hidden
            >
              {component.edges.map((edge) => (
                <path
                  key={edge.id}
                  className="cr-edge"
                  data-tone={edge.hot ? "late" : "backwards"}
                  d={edge.d}
                  strokeWidth={edge.hot ? 1.8 : 1.3}
                  fill="none"
                />
              ))}
            </svg>
            {component.nodes.map((node) => {
              const standing: Standing =
                node.step.state === "done" ? "done" : node.step.id === heldId ? "hold" : "ahead";
              return (
                <button
                  key={node.step.id}
                  type="button"
                  className="cr-chain__node focus-ring"
                  data-standing={standing}
                  aria-current={node.step.id === selectedId}
                  style={
                    {
                      "--cr-x": `${node.x}px`,
                      "--cr-y": `${node.y}px`,
                    } as CSSProperties
                  }
                  onClick={() => onSelect(node.step.id)}
                >
                  <span className="cr-node__top">
                    <span
                      className="cr-dot"
                      style={
                        projectColor(node.step.project)
                          ? ({ "--cr-dot": projectColor(node.step.project) as string } as CSSProperties)
                          : undefined
                      }
                    />
                    <span className="cr-eyebrow">{stageName(node.step.stage)}</span>
                  </span>
                  <span className="cr-chain__node-title">{node.step.title}</span>
                  <span className="cr-chain__note" data-standing={standing}>
                    {standing === "done"
                      ? "landed"
                      : standing === "hold"
                        ? "everything after waits here"
                        : node.step.needs
                          ? "waits upstream"
                          : "can start"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <ol className="cr-chain__strip">
          {chain.map((step, index) => {
            const standing = standingOf(step, index, hold);
            return (
              <li key={step.id} className="cr-chain__item">
                <button
                  type="button"
                  className="cr-chain__step focus-ring"
                  data-standing={standing}
                  aria-current={step.id === selectedId}
                  title={`${step.title} — ${stageName(step.stage)}, ${step.state}`}
                  style={
                    projectColor(step.project)
                      ? ({ "--cr-dot": projectColor(step.project) as string } as CSSProperties)
                      : undefined
                  }
                  onClick={() => onSelect(step.id)}
                >
                  <span className="cr-chain__mark">{standing === "done" ? "✓" : index + 1}</span>
                  <span className="cr-chain__body">
                    <span className="cr-chain__title">{step.title}</span>
                    <span className="cr-node__top">
                      <span className="cr-eyebrow">{stageName(step.stage)}</span>
                      <span className="cr-chain__note" data-standing={standing}>
                        {NOTE[standing]}
                      </span>
                    </span>
                  </span>
                </button>
                {index < chain.length - 1 ? (
                  <span className="cr-chain__link" data-hold={index === hold} aria-hidden>
                    <Icon name="ph:caret-right" width={11} height={11} aria-hidden />
                    {index === hold ? <span>blocks</span> : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <p className="cr-chain__how">
        {hold >= 0
          ? "Left to right is the order the work has to happen in. Amber is where it stops — nothing to its right can start until that step lands."
          : "Left to right is the order the work has to happen in. Nothing is holding it, so every step can run as its turn comes."}
      </p>
    </div>
  );
}
