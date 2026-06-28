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
  const parts: string[] = [`${index + 1}. [${step.kind}] ${step.name ?? step.id} (id: ${step.id})`];
  if (step.uses) parts.push(`uses: ${step.uses}`);
  if (step.requires && step.requires.length > 0) parts.push(`after: ${step.requires.join(", ")}`);
  if (step.on_error) parts.push(`on_error: ${step.on_error}`);
  const head = parts.join(" · ");
  const detail = step.summary?.trim();
  return detail ? `${head}\n   ${detail}` : head;
}

function formatInputValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function workflowInputLines(inputs: Record<string, unknown> | undefined): string[] {
  const entries = Object.entries(inputs ?? {})
    .map(([key, value]) => [key.trim(), formatInputValue(value)] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);

  if (entries.length === 0) {
    return [
      "Workflow input:",
      "No explicit input was provided. If required workflow input is missing, ask Val for the specific value before continuing.",
      "",
    ];
  }

  return [
    "Workflow input:",
    ...entries.map(([key, value]) => `- ${key}: ${value}`),
    "",
  ];
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

export function buildWorkflowRunPrompt(workflow: WorkflowSummary, inputs?: Record<string, unknown>): string {
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

  lines.push(...workflowInputLines(inputs));

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

  if (steps.length > 0) {
    // Progress protocol: lets Cave map your live transcript back onto the plan
    // and show each step's status + output. Keep markers on their own line.
    lines.push(
      "",
      "Progress markers — print these on their own line so progress can be tracked:",
      "- Before starting a step, print:  @@step-start <id>",
      "- While working a step, narrate what you're doing in plain language and show the step's output — that narration is surfaced as the step's log, so be clear and specific.",
      "- When a step succeeds, FIRST print a one-line summary of what it produced:  @@step-note <id> <summary>",
      "- Then print:                     @@step-done <id>",
      "- If a step fails, print a @@step-note <id> <why it failed> then:  @@step-fail <id>",
      "Use the exact id shown in parentheses for each step above. Keep each marker on its own line and never wrap one in backticks.",
    );
  }

  return lines.join("\n");
}
