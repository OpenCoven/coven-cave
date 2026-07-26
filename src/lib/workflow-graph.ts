import type { WorkflowStepSummary, WorkflowSummary } from "./workflows.ts";

function fallbackStep(workflow: WorkflowSummary): WorkflowStepSummary {
  return {
    id: workflow.id,
    kind: "workflow",
    name: workflow.name ?? workflow.id,
    summary: workflow.summary,
    uses: workflow.familiar,
  };
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
 * manifest order within a depth. Manifests with no declared dependencies keep
 * their authored order. Drives run playback / prompt ordering.
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
