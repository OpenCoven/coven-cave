// Map a running flow's agent-session transcript onto live per-node phases.
//
// A flow runs as one agent session that prints `@@step-start/done/fail <id>`
// markers (see flow-compile.ts) — the same protocol the Workflow Studio uses.
// This reuses the shared marker parser and projects its step statuses onto the
// Flow editor's node-phase vocabulary so the canvas can light nodes up live.

import {
  parseWorkflowStepProgress,
  type WorkflowStepProgress,
  type WorkflowStepProgressStatus,
} from "@/lib/workflow-step-progress";
import type { FlowRunStepRecord, FlowRunStepStatus, FlowRunStatus } from "@/lib/flows";
import type { FlowEdge } from "./flow-doc.ts";

/** Phase overlaid on a canvas node while a run/preview walks the graph. */
export type FlowNodePhase = "pending" | "running" | "succeeded" | "failed" | "skipped";

/** Live marker status → canvas phase. `active` reads as "running". */
export function flowPhase(status: WorkflowStepProgressStatus | FlowRunStepStatus): FlowNodePhase {
  return status === "active" ? "running" : status;
}

export type FlowRunProgress = {
  phases: Record<string, FlowNodePhase>;
  activeNodeId: string | null;
  done: boolean;
  markersFound: boolean;
  steps: WorkflowStepProgress[];
};

/**
 * Parse the transcript into per-node phases for the canvas overlay.
 * `orderedNodeIds` is the run's step ids in execution order.
 */
export function parseFlowRunProgress(transcript: string, orderedNodeIds: string[]): FlowRunProgress {
  const result = parseWorkflowStepProgress(transcript, orderedNodeIds);
  const phases: Record<string, FlowNodePhase> = {};
  for (const step of result.steps) phases[step.id] = flowPhase(step.status);
  return {
    phases,
    activeNodeId: result.activeStepId,
    done: result.done,
    markersFound: result.markersFound,
    steps: result.steps,
  };
}

/** Persisted run steps → canvas phases for inspecting a historical execution. */
export function phasesFromRunSteps(steps: FlowRunStepRecord[]): Record<string, FlowNodePhase> {
  return Object.fromEntries(steps.map((step) => [step.id, step.status]));
}

export type FlowNodeRunData = {
  status: FlowNodePhase;
  /** The current node wiring/config differs from the snapshot that produced this data. */
  stale?: boolean;
  /** This node's narration from the run (its "output"). */
  output: string;
  /** Upstream nodes feeding this one, with their narration (its "input"). */
  inputs: Array<{ nodeId: string; detail: string }>;
};

type FlowNodeRunDataStep = {
  id: string;
  status: WorkflowStepProgressStatus | FlowRunStepStatus;
  detail?: string;
};

/**
 * The run "data" for one node, the way n8n's node view shows it: this node's
 * own output narration plus the narration of the upstream nodes that feed it
 * (its input). Grounded in the agent's per-step transcript — never fabricated.
 */
export function selectNodeRunData(
  edges: FlowEdge[],
  steps: FlowNodeRunDataStep[],
  nodeId: string,
): FlowNodeRunData {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const self = byId.get(nodeId);
  const seen = new Set<string>();
  const inputs: Array<{ nodeId: string; detail: string }> = [];
  for (const edge of edges) {
    if (edge.target !== nodeId || seen.has(edge.source)) continue;
    seen.add(edge.source);
    inputs.push({ nodeId: edge.source, detail: byId.get(edge.source)?.detail ?? "" });
  }
  return { status: flowPhase(self?.status ?? "pending"), output: self?.detail ?? "", inputs };
}

/** Live marker status → persisted run-step status (for a finished run). */
function finalStepStatus(status: WorkflowStepProgressStatus | undefined): FlowRunStepStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "active") return "running";
  // Never reached (no start marker) → skipped.
  return "skipped";
}

/**
 * Roll a completed run's parsed progress into persisted step records (matched
 * to the run's existing steps so node types are preserved) plus an overall
 * verdict: failed if any node failed, otherwise succeeded.
 */
export function finalizeFlowSteps(
  runSteps: FlowRunStepRecord[],
  progressSteps: WorkflowStepProgress[],
  options: { redactDetails?: boolean } = {},
): { steps: FlowRunStepRecord[]; status: FlowRunStatus } {
  const byId = new Map(progressSteps.map((step) => [step.id, step]));
  const steps = runSteps.map((step) => {
    const { detail: _detail, ...rest } = step;
    const progress = byId.get(step.id);
    const next: FlowRunStepRecord = { ...rest, status: finalStepStatus(progress?.status) };
    if (!options.redactDetails && progress?.detail) next.detail = progress.detail;
    return next;
  });
  const status: FlowRunStatus = steps.some((step) => step.status === "failed") ? "failed" : "succeeded";
  return { steps, status };
}
