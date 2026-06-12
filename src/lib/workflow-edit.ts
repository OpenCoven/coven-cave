import { stringify } from "yaml";
import type { WorkflowPattern, WorkflowStepSummary, WorkflowSummary } from "./workflows.ts";

/**
 * Editing-side companion to workflow-source: turns Cave studio state back into
 * canonical CWF-01 manifests. Serialization is key-ordered so saved YAML diffs
 * stay stable, and cave-only fields (`path`, `validation_state`) never leak
 * into manifests.
 */

const STEP_KEY_ORDER = [
  "id",
  "kind",
  "name",
  "uses",
  "summary",
  "requires",
  "permissions",
  "on_error",
] as const;

const WORKFLOW_KEY_ORDER = [
  "id",
  "version",
  "name",
  "summary",
  "familiar",
  "pattern",
  "tags",
  "limits",
  "permissions",
  "visibility",
  "steps",
] as const;

function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      const nested = compact(value as Record<string, unknown>);
      if (Object.keys(nested).length === 0) continue;
      out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function orderKeys(obj: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) {
    if (key in obj) out[key] = obj[key];
  }
  for (const key of Object.keys(obj)) {
    if (!(key in out)) out[key] = obj[key];
  }
  return out;
}

function stepToManifest(step: WorkflowStepSummary): Record<string, unknown> {
  return orderKeys(compact({ ...step }), STEP_KEY_ORDER);
}

/** Canonical manifest object for a workflow — cave-only fields stripped. */
export function workflowToManifest(workflow: WorkflowSummary): Record<string, unknown> {
  const { path: _path, validation_state: _state, ...rest } = workflow;
  const manifest = compact({
    ...rest,
    steps: undefined,
  });
  if (workflow.steps && workflow.steps.length > 0) {
    manifest.steps = workflow.steps.map((step) => stepToManifest(step));
  }
  return orderKeys(manifest, WORKFLOW_KEY_ORDER);
}

/** YAML text for the canonical manifest. */
export function workflowToYaml(workflow: WorkflowSummary): string {
  return stringify(workflowToManifest(workflow), { lineWidth: 0 });
}

/** Lowercase kebab id safe for `workflowFileName`. */
export function slugifyWorkflowId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug.length > 0 ? slug.slice(0, 80) : "untitled-workflow";
}

function step(
  id: string,
  kind: WorkflowStepSummary["kind"],
  name: string,
  summary: string,
  requires?: string[],
): WorkflowStepSummary {
  return { id, kind, name, summary, requires };
}

/**
 * Starter step scaffolds per CWF-01 pattern. Each template validates clean so
 * a freshly created workflow is immediately saveable and runnable-by-plan.
 */
export const WORKFLOW_TEMPLATES: Record<WorkflowPattern, WorkflowStepSummary[]> = {
  "sequential": [
    step("plan", "agent", "Plan", "Break the goal into ordered work."),
    step("execute", "agent", "Execute", "Carry out the plan.", ["plan"]),
    step("review", "human-gate", "Review", "Hold for human sign-off on the result.", ["execute"]),
  ],
  "fan-out-and-synthesize": [
    step("fan-out", "agent", "Fan out", "Dispatch parallel workers over the input set."),
    step("synthesize", "agent", "Synthesize", "Merge worker results into one deliverable.", ["fan-out"]),
    step("deliver", "tool", "Deliver", "Emit the synthesized output.", ["synthesize"]),
  ],
  "classify-and-act": [
    step("classify", "agent", "Classify", "Label each input with its handling route."),
    step("act", "agent", "Act", "Apply the route-specific action per item.", ["classify"]),
  ],
  "adversarial-verification": [
    step("propose", "agent", "Propose", "Produce candidate findings or output."),
    step("refute", "agent", "Refute", "Adversarially attack each candidate.", ["propose"]),
    step("verdict", "agent", "Verdict", "Keep only candidates that survive refutation.", ["refute"]),
  ],
  "generate-and-filter": [
    step("generate", "agent", "Generate", "Produce a wide pool of candidates."),
    step("filter", "agent", "Filter", "Score and keep the best candidates.", ["generate"]),
  ],
  "tournament": [
    step("seed", "agent", "Seed", "Generate bracket entrants."),
    step("rounds", "agent", "Rounds", "Run pairwise elimination rounds.", ["seed"]),
    step("champion", "tool", "Champion", "Emit the winning entry.", ["rounds"]),
  ],
  "loop-until-done": [
    step("attempt", "agent", "Attempt", "Run one iteration toward the goal."),
    step("check", "agent", "Check", "Decide whether the goal is met or another loop is needed.", ["attempt"]),
  ],
  "custom": [
    step("start", "agent", "Start", "First step of the custom flow."),
    step("finish", "tool", "Finish", "Emit the final output.", ["start"]),
  ],
};

/** New workflow seeded from a pattern template. */
export function createWorkflowFromTemplate(opts: {
  id: string;
  name?: string;
  pattern: WorkflowPattern;
  familiar?: string;
}): WorkflowSummary {
  const steps = (WORKFLOW_TEMPLATES[opts.pattern] ?? WORKFLOW_TEMPLATES.custom).map((entry) => ({
    ...entry,
    requires: entry.requires ? [...entry.requires] : undefined,
  }));
  return {
    id: opts.id,
    version: "0.1.0",
    name: opts.name ?? opts.id,
    pattern: opts.pattern,
    familiar: opts.familiar,
    steps,
    visibility: { coven_cave: true },
  };
}

/** Detached deep copy under a new id, ready to save as a new manifest. */
export function duplicateWorkflow(workflow: WorkflowSummary, newId: string): WorkflowSummary {
  const copy = structuredClone(workflow);
  delete copy.path;
  delete copy.validation_state;
  copy.id = newId;
  copy.name = `${workflow.name ?? workflow.id} copy`;
  return copy;
}
