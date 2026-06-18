import { workflowExecutionOrder } from "./workflow-graph.ts";
import type { WorkflowStepSummary, WorkflowSummary } from "./workflows.ts";

/**
 * Compile a workflow manifest into an orchestration prompt for a single capable
 * agent session. The Cave has no server-side LLM and the daemon has no workflow
 * engine yet, but the daemon *can* spawn a real agent session (the same
 * primitive the board uses to run a card as a task). So "running" a workflow
 * here means handing its compiled plan to one orchestrator agent that carries
 * out the steps in dependency order — a genuine execution, not a preview.
 *
 * Pure + framework-free so it can be unit-tested and reused by the run route.
 */

function stepLine(step: WorkflowStepSummary, index: number): string {
  const parts: string[] = [`${index + 1}. [${step.kind}] ${step.name ?? step.id}`];
  if (step.uses) parts.push(`uses: ${step.uses}`);
  if (step.requires && step.requires.length > 0) parts.push(`after: ${step.requires.join(", ")}`);
  if (step.on_error) parts.push(`on_error: ${step.on_error}`);
  const head = parts.join(" · ");
  const detail = step.summary?.trim();
  return detail ? `${head}\n   ${detail}` : head;
}

/** Order the manifest's steps the way a run would activate them (dependency depth, then authored order). */
export function orderedWorkflowSteps(workflow: WorkflowSummary): WorkflowStepSummary[] {
  const steps = workflow.steps ?? [];
  if (steps.length === 0) return [];
  const order = workflowExecutionOrder(workflow);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const ordered = order.map((id) => byId.get(id)).filter((step): step is WorkflowStepSummary => Boolean(step));
  // Any step the execution order didn't name (defensive) keeps its authored slot at the end.
  for (const step of steps) if (!ordered.includes(step)) ordered.push(step);
  return ordered;
}

export function buildWorkflowRunPrompt(workflow: WorkflowSummary): string {
  const title = workflow.name ?? workflow.id;
  const lines: string[] = [
    `You are executing the "${title}" workflow.`,
    "",
  ];

  if (workflow.summary?.trim()) {
    lines.push(workflow.summary.trim(), "");
  }

  const meta: string[] = [];
  if (workflow.pattern) meta.push(`Pattern: ${workflow.pattern}`);
  if (workflow.familiar) meta.push(`Familiar: ${workflow.familiar}`);
  const limits = workflow.limits;
  if (limits?.max_agents) meta.push(`Max agents: ${limits.max_agents}`);
  if (limits?.timeout_s) meta.push(`Timeout: ${limits.timeout_s}s`);
  if (limits?.cost_ceiling_usd) meta.push(`Cost ceiling: $${limits.cost_ceiling_usd}`);
  if (meta.length > 0) lines.push(...meta, "");

  const steps = orderedWorkflowSteps(workflow);
  if (steps.length > 0) {
    lines.push("Carry out these steps in order, respecting the declared dependencies:", "");
    steps.forEach((step, index) => lines.push(stepLine(step, index)));
    lines.push("");
  }

  lines.push(
    "Work through the plan end to end. Where a step names a skill, tool, or sub-workflow, use it.",
    "Stop and ask before any destructive or irreversible action. Report what each step produced as you go.",
  );

  return lines.join("\n");
}
