"use client";

import { useMemo } from "react";
import { Icon } from "@/lib/icon";
import {
  workflowToGraph,
  type WorkflowGraphNode,
} from "@/lib/workflow-graph";
import {
  activeStepId,
  nodePhases,
  type WorkflowNodePhase,
  type WorkflowPlaybackState,
} from "@/lib/workflow-playback";
import type { WorkflowDryRunPlan, WorkflowSummary } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

type WorkflowStepListProps = {
  workflow: WorkflowSummary | null;
  action: WorkflowStudioActionState | null;
  selectedNode: WorkflowGraphNode | null;
  playback: WorkflowPlaybackState | null;
  onSelectNode: (node: WorkflowGraphNode) => void;
  onRemoveStep: (id: string) => void;
};

const PHASE_LABEL: Record<WorkflowNodePhase, string> = {
  pending: "queued",
  active: "running",
  done: "done",
  blocked: "blocked",
};

// Mirror of workflow-canvas.tsx's local helper — the dry-run plan is only an
// overlay when the last action was a dry-run.
function dryRunFromAction(action: WorkflowStudioActionState | null): WorkflowDryRunPlan | undefined {
  if (action?.kind !== "dry-run") return undefined;
  return action.result as WorkflowDryRunPlan;
}

/**
 * Mobile-first linear view of a workflow's steps. React Flow's pan/zoom canvas
 * is awkward on a phone, so below the shell breakpoint we render the same graph
 * nodes (same `workflowToGraph` source the canvas uses) as a vertical, scrollable
 * ordered list. Tapping a step selects it (opening the shared inspector); the
 * trash affordance removes it. Playback/dry-run phase + status badges mirror the
 * canvas so the two views read identically.
 */
export function WorkflowStepList({
  workflow,
  action,
  selectedNode,
  playback,
  onSelectNode,
  onRemoveStep,
}: WorkflowStepListProps) {
  const nodes = useMemo<WorkflowGraphNode[]>(() => {
    if (!workflow) return [];
    // savedPositions/layoutDirection don't matter for a linear list — nodes come
    // back in step-definition order, which is the order we render.
    return workflowToGraph(workflow, dryRunFromAction(action), null, "vertical").nodes;
  }, [workflow, action]);

  const phases = useMemo(() => (playback ? nodePhases(playback) : null), [playback]);
  const activeId = useMemo(() => (playback ? activeStepId(playback) : null), [playback]);

  if (!workflow) {
    return (
      <section className="workflow-step-list workflow-step-list-empty" aria-label="Workflow steps">
        <p className="workflow-step-list-empty-text">Select a workflow to see its steps.</p>
      </section>
    );
  }

  return (
    <section className="workflow-step-list" aria-label={`${workflow.name ?? workflow.id} steps`}>
      <ol className="workflow-step-list-items">
        {nodes.map((node, index) => {
          const data = node.data;
          const phase = phases?.[node.id];
          const selected = selectedNode?.id === node.id;
          const isActive = activeId === node.id;
          return (
            <li key={node.id} className="workflow-step-list-item">
              <button
                type="button"
                className={`workflow-step-card workflow-node-${data.tone}${
                  phase ? ` workflow-node-phase-${phase}` : ""
                }${selected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                aria-pressed={selected}
                onClick={() => onSelectNode(node)}
              >
                <span className="workflow-step-index" aria-hidden>
                  {index + 1}
                </span>
                <span className="workflow-step-body">
                  <span className="workflow-step-kind">{data.kind}</span>
                  <span className="workflow-step-label">{data.label}</span>
                  {data.uses && <span className="workflow-step-uses">{data.uses}</span>}
                </span>
                {phase ? (
                  <span className={`workflow-step-pill workflow-node-phase-pill-${phase}`}>
                    {phase === "active" && <span className="workflow-node-phase-spinner" aria-hidden />}
                    {PHASE_LABEL[phase]}
                  </span>
                ) : (
                  data.status && (
                    <span className={`workflow-step-pill workflow-node-status-${data.status}`}>
                      {data.status}
                    </span>
                  )
                )}
              </button>
              <button
                type="button"
                className="workflow-step-remove"
                aria-label={`Remove step ${data.label}`}
                title="Remove step"
                onClick={() => onRemoveStep(node.id)}
              >
                <Icon name="ph:trash" width={14} aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
