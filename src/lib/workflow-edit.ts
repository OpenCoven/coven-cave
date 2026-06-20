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
  const { path: _path, validation_state: _state, storage: _storage, ...rest } = workflow;
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
 * Starter step scaffolds per CWF-01 pattern. Each template is bracketed by an
 * `input` node (the required input) and an `output` node (the produced
 * artifact) so a freshly created workflow already satisfies the I/O contract and
 * is immediately saveable, validatable, and runnable-by-plan.
 */
export const WORKFLOW_TEMPLATES: Record<WorkflowPattern, WorkflowStepSummary[]> = {
  "sequential": [
    step("input", "input", "Input", "The goal and any context the workflow needs to start."),
    step("plan", "agent", "Plan", "Break the goal into ordered work.", ["input"]),
    step("execute", "agent", "Execute", "Carry out the plan.", ["plan"]),
    step("review", "human-gate", "Review", "Hold for human sign-off on the result.", ["execute"]),
    step("output", "output", "Output", "The reviewed deliverable.", ["review"]),
  ],
  "fan-out-and-synthesize": [
    step("input", "input", "Input", "The input set to fan workers out over."),
    step("fan-out", "agent", "Fan out", "Dispatch parallel workers over the input set.", ["input"]),
    step("synthesize", "agent", "Synthesize", "Merge worker results into one deliverable.", ["fan-out"]),
    step("output", "output", "Output", "The synthesized deliverable.", ["synthesize"]),
  ],
  "classify-and-act": [
    step("input", "input", "Input", "The items to classify and act on."),
    step("classify", "agent", "Classify", "Label each input with its handling route.", ["input"]),
    step("act", "agent", "Act", "Apply the route-specific action per item.", ["classify"]),
    step("output", "output", "Output", "The acted-on result per item.", ["act"]),
  ],
  "adversarial-verification": [
    step("input", "input", "Input", "The claim or material to verify."),
    step("propose", "agent", "Propose", "Produce candidate findings or output.", ["input"]),
    step("refute", "agent", "Refute", "Adversarially attack each candidate.", ["propose"]),
    step("verdict", "agent", "Verdict", "Keep only candidates that survive refutation.", ["refute"]),
    step("output", "output", "Output", "The verified findings.", ["verdict"]),
  ],
  "generate-and-filter": [
    step("input", "input", "Input", "The brief the candidates should satisfy."),
    step("generate", "agent", "Generate", "Produce a wide pool of candidates.", ["input"]),
    step("filter", "agent", "Filter", "Score and keep the best candidates.", ["generate"]),
    step("output", "output", "Output", "The selected best candidates.", ["filter"]),
  ],
  "tournament": [
    step("input", "input", "Input", "The pool to seed the bracket from."),
    step("seed", "agent", "Seed", "Generate bracket entrants.", ["input"]),
    step("rounds", "agent", "Rounds", "Run pairwise elimination rounds.", ["seed"]),
    step("output", "output", "Output", "The winning entry.", ["rounds"]),
  ],
  "loop-until-done": [
    step("input", "input", "Input", "The goal and the done-condition."),
    step("attempt", "agent", "Attempt", "Run one iteration toward the goal.", ["input"]),
    step("check", "agent", "Check", "Decide whether the goal is met or another loop is needed.", ["attempt"]),
    step("output", "output", "Output", "The completed result once the goal is met.", ["check"]),
  ],
  "custom": [
    step("input", "input", "Input", "What this workflow needs to start."),
    step("work", "agent", "Work", "Do the workflow's main work.", ["input"]),
    step("output", "output", "Output", "The artifact this workflow produces.", ["work"]),
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

/** Order-independent signature of a step's editable fields, for change detection. */
function stepSignature(step: WorkflowStepSummary): string {
  return JSON.stringify({
    id: step.id,
    kind: step.kind,
    name: step.name ?? null,
    uses: step.uses ?? null,
    summary: step.summary ?? null,
    on_error: step.on_error ?? null,
    requires: [...(step.requires ?? [])].sort(),
    permissions: [...(step.permissions ?? [])].sort(),
  });
}

/** Human summary of how `draft`'s steps differ from `saved`'s (added/removed/changed). */
function summarizeStepChanges(saved: WorkflowStepSummary[], draft: WorkflowStepSummary[]): string | null {
  const savedById = new Map(saved.map((step) => [step.id, step]));
  const draftIds = new Set(draft.map((step) => step.id));
  let added = 0;
  let changed = 0;
  for (const step of draft) {
    const prior = savedById.get(step.id);
    if (!prior) added += 1;
    else if (stepSignature(prior) !== stepSignature(step)) changed += 1;
  }
  const removed = saved.filter((step) => !draftIds.has(step.id)).length;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (changed) parts.push(`${changed} changed`);
  return parts.length > 0 ? `steps (${parts.join(", ")})` : null;
}

/**
 * The list of top-level fields that differ between the saved workflow and the
 * working draft — what an unsaved Save would write. Pure, so the studio can show
 * "Unsaved changes: name, permissions, steps (1 added)" without re-deriving it.
 */
export function summarizeWorkflowChanges(saved: WorkflowSummary, draft: WorkflowSummary): string[] {
  const changes: string[] = [];
  const scalar = (a: unknown, b: unknown, label: string) => {
    if ((a ?? "") !== (b ?? "")) changes.push(label);
  };
  if (saved.id !== draft.id) changes.push("id");
  scalar(saved.name, draft.name, "name");
  scalar(saved.version, draft.version, "version");
  scalar(saved.summary, draft.summary, "summary");
  scalar(saved.pattern, draft.pattern, "pattern");
  scalar(saved.familiar, draft.familiar, "familiar");

  const listChanged = (a?: string[], b?: string[]) => (a ?? []).join(" ") !== (b ?? []).join(" ");
  if (listChanged(saved.tags, draft.tags)) changes.push("tags");
  if (listChanged(saved.permissions, draft.permissions)) changes.push("permissions");

  const limitChanged = (key: keyof NonNullable<WorkflowSummary["limits"]>) =>
    (saved.limits?.[key] ?? undefined) !== (draft.limits?.[key] ?? undefined);
  if (limitChanged("max_agents") || limitChanged("timeout_s") || limitChanged("cost_ceiling_usd")) {
    changes.push("limits");
  }

  const stepChange = summarizeStepChanges(saved.steps ?? [], draft.steps ?? []);
  if (stepChange) changes.push(stepChange);

  return changes;
}
