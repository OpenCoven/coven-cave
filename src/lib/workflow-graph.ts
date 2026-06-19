import type { WorkflowDryRunPlan, WorkflowStepKind, WorkflowStepSummary, WorkflowSummary } from "./workflows.ts";

export type WorkflowNodeTone = "input" | "agent" | "gate" | "tool" | "workflow" | "output" | "unknown";

export type WorkflowGraphNodeData = {
  label: string;
  kind: WorkflowStepKind;
  tone: WorkflowNodeTone;
  uses?: string;
  summary?: string;
  issues: number;
  status?: "ready" | "blocked";
  /** Live playback phase overlaid by the canvas while a run/preview walks the graph. */
  phase?: "pending" | "active" | "done" | "blocked";
};

export type WorkflowGraphNode = {
  id: string;
  type: "workflowStep";
  position: {
    x: number;
    y: number;
  };
  data: WorkflowGraphNodeData;
};

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
  animated: boolean;
};

export type WorkflowGraph = {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};

export type WorkflowLayoutDirection = "horizontal" | "vertical";

export function workflowNodeTone(kind: WorkflowStepKind): WorkflowNodeTone {
  if (kind === "input") return "input";
  if (kind === "agent") return "agent";
  if (kind === "human-gate") return "gate";
  if (kind === "skill" || kind === "tool") return "tool";
  if (kind === "workflow") return "workflow";
  if (kind === "output") return "output";
  return "unknown";
}

function fallbackStep(workflow: WorkflowSummary): WorkflowStepSummary {
  return {
    id: workflow.id,
    kind: "workflow",
    name: workflow.name ?? workflow.id,
    summary: workflow.summary,
    uses: workflow.familiar,
  };
}

type WorkflowDryRunStep = NonNullable<WorkflowDryRunPlan["steps"]>[number];

function dryRunStepFor(step: WorkflowStepSummary, dryRun?: WorkflowDryRunPlan): WorkflowDryRunStep | undefined {
  return dryRun?.steps?.find((planStep) => planStep.id === step.id);
}

function workflowEdges(steps: WorkflowStepSummary[], dryRun?: WorkflowDryRunPlan): WorkflowGraphEdge[] {
  const animated = dryRun?.ok === true;
  const hasDependencyEdges = steps.some((step) => step.requires && step.requires.length > 0);
  if (hasDependencyEdges) {
    return steps.flatMap((step) =>
      (step.requires ?? []).map((source) => ({
        id: `${source}->${step.id}`,
        source,
        target: step.id,
        animated,
      })),
    );
  }

  return steps.slice(1).map((step, index): WorkflowGraphEdge => {
    const previous = steps[index];
    return {
      id: `${previous.id}->${step.id}`,
      source: previous.id,
      target: step.id,
      animated,
    };
  });
}

/**
 * Dependency depth per step: 0 for roots, 1 + max(depth of requires) otherwise.
 * Unknown references and cycles degrade to depth 0 instead of throwing so an
 * invalid draft still lays out.
 */
function stepDepths(steps: WorkflowStepSummary[]): Map<string, number> {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const requires = (byId.get(id)?.requires ?? []).filter((dep) => byId.has(dep));
    const depth = requires.length === 0 ? 0 : 1 + Math.max(...requires.map(depthOf));
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };
  for (const step of steps) depthOf(step.id);
  return depths;
}

/**
 * Step ids in the order a run would activate them: by dependency depth, then
 * manifest order within a depth (the same layering the canvas lays out). Used
 * to drive playback so the visual walkthrough matches the graph's left→right
 * flow. Manifests with no declared dependencies keep their authored order.
 */
export function workflowExecutionOrder(workflow: WorkflowSummary): string[] {
  const steps = workflow.steps && workflow.steps.length > 0 ? workflow.steps : [fallbackStep(workflow)];
  const hasDependencyEdges = steps.some((step) => step.requires && step.requires.length > 0);
  if (!hasDependencyEdges) return steps.map((step) => step.id);
  const depths = stepDepths(steps);
  return steps
    .map((step, index) => ({ id: step.id, depth: depths.get(step.id) ?? index, index }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((entry) => entry.id);
}

export type WorkflowNodePositions = Record<string, { x: number; y: number }>;

export function workflowToGraph(
  workflow: WorkflowSummary,
  dryRun?: WorkflowDryRunPlan,
  savedPositions?: WorkflowNodePositions | null,
  layoutDirection: WorkflowLayoutDirection = "horizontal",
): WorkflowGraph {
  const steps = workflow.steps && workflow.steps.length > 0 ? workflow.steps : [fallbackStep(workflow)];
  // Layered layout: column = dependency depth (manifest order when no
  // dependencies are declared), lane = arrival order within the column.
  const hasDependencyEdges = steps.some((step) => step.requires && step.requires.length > 0);
  const depths = hasDependencyEdges ? stepDepths(steps) : null;
  const laneCounts = new Map<number, number>();
  const nodes = steps.map((step, index): WorkflowGraphNode => {
    const dryRunStep = dryRunStepFor(step, dryRun);
    const depth = depths?.get(step.id) ?? index;
    const lane = laneCounts.get(depth) ?? 0;
    laneCounts.set(depth, lane + 1);
    // Dragged positions (cave sidecar) win; the layered layout is the
    // default for steps that have never been moved.
    const saved = savedPositions?.[step.id];
    return {
      id: step.id,
      type: "workflowStep",
      position: saved ?? {
        x: layoutDirection === "vertical" ? 80 + lane * 240 : 80 + depth * 240,
        y: layoutDirection === "vertical" ? 80 + depth * 140 : 80 + lane * 140,
      },
      data: {
        label: step.name ?? step.id,
        kind: step.kind,
        tone: workflowNodeTone(step.kind),
        uses: step.uses,
        summary: step.summary,
        issues: dryRunStep?.blockers?.length ?? 0,
        status: dryRunStep?.status,
      },
    };
  });
  const edges = workflowEdges(steps, dryRun);

  return { nodes, edges };
}
