import type { WorkflowDryRunPlan, WorkflowStepKind, WorkflowStepSummary, WorkflowSummary } from "./workflows.ts";

export type WorkflowNodeTone = "agent" | "gate" | "tool" | "workflow" | "output" | "unknown";

export type WorkflowGraphNodeData = {
  label: string;
  kind: WorkflowStepKind;
  tone: WorkflowNodeTone;
  uses?: string;
  summary?: string;
  issues: number;
};

export type WorkflowGraphNode = {
  id: string;
  type: "workflow";
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

export function workflowNodeTone(kind: WorkflowStepKind): WorkflowNodeTone {
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

function issueCountForStep(step: WorkflowStepSummary, dryRun?: WorkflowDryRunPlan): number {
  return dryRun?.steps?.find((planStep) => planStep.id === step.id)?.blockers?.length ?? 0;
}

export function workflowToGraph(workflow: WorkflowSummary, dryRun?: WorkflowDryRunPlan): WorkflowGraph {
  const steps = workflow.steps && workflow.steps.length > 0 ? workflow.steps : [fallbackStep(workflow)];
  const nodes = steps.map((step, index): WorkflowGraphNode => {
    return {
      id: step.id,
      type: "workflow",
      position: {
        x: 80 + index * 220,
        y: 90 + (index % 2) * 130,
      },
      data: {
        label: step.name ?? step.id,
        kind: step.kind,
        tone: workflowNodeTone(step.kind),
        uses: step.uses,
        summary: step.summary,
        issues: issueCountForStep(step, dryRun),
      },
    };
  });
  const edges = steps.slice(1).map((step, index): WorkflowGraphEdge => {
    const previous = steps[index];
    return {
      id: `${previous.id}->${step.id}`,
      source: previous.id,
      target: step.id,
      animated: dryRun?.ok === true,
    };
  });

  return { nodes, edges };
}
