import { workflowExecutionOrder } from "./workflow-graph.ts";
import type { WorkflowDryRunPlan, WorkflowRunRecord, WorkflowSummary } from "./workflows.ts";

/**
 * Client-side playback model for the Workflow Studio. The daemon has no run
 * engine yet, so "playing" a workflow walks the steps in execution order and
 * lights up each node from a HONEST source of truth: a dry-run plan's per-step
 * ready/blocked verdict, or a recorded run's step outcomes (replay). It never
 * fabricates execution — a plan preview is labelled as such, and once the
 * daemon engine lands the same model can be fed live step telemetry.
 *
 * Pure + framework-free so the view layer owns the ticking (one timer) and the
 * canvas just reads derived node phases. Tested in isolation.
 */

export type WorkflowNodePhase = "pending" | "active" | "done" | "blocked";

export type WorkflowPlaybackSource = "dry-run" | "play" | "replay";

/** Per-step terminal verdict the playback resolves a node to once the cursor passes it. */
export type WorkflowStepOutcome = "ready" | "blocked" | "succeeded" | "failed" | "skipped";

export type WorkflowPlaybackState = {
  workflowId: string;
  /** Why the walkthrough is running — drives the honest label in the UI. */
  source: WorkflowPlaybackSource;
  /** Step ids in execution order. */
  order: string[];
  /** Resolved verdict per step id. */
  outcome: Record<string, WorkflowStepOutcome>;
  /** Index currently activating; 0..order.length. Equals order.length when finished. */
  cursor: number;
  /** Wall-clock start, for elapsed display. */
  startedAtMs: number;
};

function isBlockedOutcome(outcome: WorkflowStepOutcome | undefined): boolean {
  return outcome === "blocked" || outcome === "failed";
}

/** True once the cursor has stepped past the final node. */
export function playbackFinished(state: WorkflowPlaybackState): boolean {
  return state.cursor >= state.order.length;
}

/** Advance the cursor by one node (no-op once finished). */
export function advancePlayback(state: WorkflowPlaybackState): WorkflowPlaybackState {
  if (playbackFinished(state)) return state;
  return { ...state, cursor: state.cursor + 1 };
}

/** The node id currently activating, or null when finished / empty. */
export function activeStepId(state: WorkflowPlaybackState): string | null {
  if (playbackFinished(state)) return null;
  return state.order[state.cursor] ?? null;
}

/** Phase for one node id: done/blocked behind the cursor, active at it, pending ahead. */
export function nodePhase(state: WorkflowPlaybackState, id: string): WorkflowNodePhase {
  const index = state.order.indexOf(id);
  if (index < 0) return "pending";
  if (index < state.cursor) return isBlockedOutcome(state.outcome[id]) ? "blocked" : "done";
  if (index === state.cursor && !playbackFinished(state)) return "active";
  return "pending";
}

/** Phase map keyed by step id, for the canvas to overlay. */
export function nodePhases(state: WorkflowPlaybackState): Record<string, WorkflowNodePhase> {
  const phases: Record<string, WorkflowNodePhase> = {};
  for (const id of state.order) phases[id] = nodePhase(state, id);
  return phases;
}

/** Count of steps resolved to a blocked/failed verdict. */
export function blockedCount(state: WorkflowPlaybackState): number {
  return state.order.filter((id) => isBlockedOutcome(state.outcome[id])).length;
}

/** Short progress string: "step 2 / 5" while running, an outcome rollup when finished. */
export function playbackSummary(state: WorkflowPlaybackState): string {
  const total = state.order.length;
  if (total === 0) return "no steps";
  if (!playbackFinished(state)) return `step ${state.cursor + 1} / ${total}`;
  const blocked = blockedCount(state);
  return blocked > 0 ? `${total} steps · ${blocked} blocked` : `${total} steps · all ready`;
}

/** Seed playback from a dry-run plan, resolving each step to its plan verdict. */
export function playbackFromPlan(
  workflow: WorkflowSummary,
  plan: WorkflowDryRunPlan,
  source: WorkflowPlaybackSource,
): WorkflowPlaybackState {
  const order = workflowExecutionOrder(workflow);
  const outcome: Record<string, WorkflowStepOutcome> = {};
  for (const id of order) {
    outcome[id] = plan.steps?.find((step) => step.id === id)?.status ?? "ready";
  }
  return { workflowId: workflow.id, source, order, outcome, cursor: 0, startedAtMs: Date.now() };
}

/** Seed playback from a recorded run, replaying its step outcomes in stored order. */
export function playbackFromRun(run: WorkflowRunRecord): WorkflowPlaybackState {
  const order = run.steps.map((step) => step.id);
  const outcome: Record<string, WorkflowStepOutcome> = {};
  for (const step of run.steps) outcome[step.id] = step.status;
  return { workflowId: run.workflowId, source: "replay", order, outcome, cursor: 0, startedAtMs: Date.now() };
}
