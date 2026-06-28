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
  /** Raw agent-session output, surfaced as run logs so a stalled run is legible. */
  transcript: string;
};

/**
 * Parse the transcript into per-node phases for the canvas overlay.
 * `ordered` is the run's steps (preferred) or ids in execution order. Passing
 * steps preserves seeded local progress before transcript markers arrive.
 */
export function parseFlowRunProgress(
  transcript: string,
  ordered: string[] | Array<Pick<FlowRunStepRecord, "id" | "status" | "type">>,
): FlowRunProgress {
  const orderedNodeIds = ordered.map((step) => typeof step === "string" ? step : step.id);
  const seedById = new Map<string, FlowRunStepStatus>();
  let seenActiveAgentStep = false;
  for (const step of ordered) {
    if (typeof step === "string") continue;
    let status = step.status;
    if (status === "pending") {
      if (step.type.startsWith("trigger.") || step.type.startsWith("input.")) {
        status = "succeeded";
      } else if (!seenActiveAgentStep) {
        status = "running";
      }
    }
    if (status === "running") seenActiveAgentStep = true;
    seedById.set(step.id, status);
  }
  const result = parseWorkflowStepProgress(transcript, orderedNodeIds);
  const phases: Record<string, FlowNodePhase> = {};
  let activeNodeId = result.activeStepId;
  const steps = result.steps.map((step) => {
    const seeded = seedById.get(step.id);
    let status = step.status;
    if (!result.markersFound && seeded) {
      status = seeded === "running" ? "active" : seeded === "skipped" ? "succeeded" : seeded;
    }
    const phase = flowPhase(status);
    if (result.markersFound && phase === "pending" && (seeded === "succeeded" || seeded === "skipped")) {
      phases[step.id] = seeded;
    } else {
      phases[step.id] = phase;
    }
    return { ...step, status };
  });
  if (!result.markersFound) {
    activeNodeId = orderedNodeIds.find((id) => seedById.get(id) === "running") ?? null;
  }
  const done =
    orderedNodeIds.length > 0 &&
    orderedNodeIds.every((id) => phases[id] === "succeeded" || phases[id] === "failed" || phases[id] === "skipped");
  return {
    phases,
    activeNodeId,
    done,
    markersFound: result.markersFound,
    steps,
    transcript,
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
