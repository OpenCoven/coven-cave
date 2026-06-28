import assert from "node:assert/strict";
import { buildWorkflowRunPrompt, orderedWorkflowSteps } from "./workflow-run-prompt.ts";
import type { WorkflowSummary } from "./workflows.ts";

const dependent: WorkflowSummary = {
  id: "research",
  version: "1.0.0",
  name: "Research sweep",
  summary: "Fan out, then synthesize.",
  pattern: "fan-out-and-synthesize",
  familiar: "salem",
  limits: { max_agents: 4, timeout_s: 600, cost_ceiling_usd: 2 },
  steps: [
    { id: "synth", kind: "agent", name: "Synthesize", requires: ["search-a", "search-b"], summary: "Merge findings." },
    { id: "search-a", kind: "agent", name: "Search A" },
    { id: "search-b", kind: "agent", name: "Search B" },
  ],
};

// orderedWorkflowSteps walks dependency depth first: both searches precede the synth.
{
  const order = orderedWorkflowSteps(dependent).map((step) => step.id);
  assert.deepEqual(order, ["search-a", "search-b", "synth"]);
}

// The prompt names the workflow, its summary, metadata, and every step in order.
{
  const prompt = buildWorkflowRunPrompt(dependent);
  assert.match(prompt, /Research sweep/);
  assert.match(prompt, /Fan out, then synthesize\./);
  assert.match(prompt, /Pattern: fan-out-and-synthesize/);
  assert.match(prompt, /Max agents: 4/);
  assert.match(prompt, /Cost ceiling: \$2/);
  // Steps render in execution order with their kind tag.
  const searchAIndex = prompt.indexOf("Search A");
  const synthIndex = prompt.indexOf("Synthesize");
  assert.ok(searchAIndex > -1 && synthIndex > -1 && searchAIndex < synthIndex);
  assert.match(prompt, /\[agent\]/);
  assert.match(prompt, /after: search-a, search-b/);
  // Honest guardrail: the agent must pause before destructive actions.
  assert.match(prompt, /destructive or irreversible/);
}

// Runtime inputs should appear in a clear block, and missing required context
// should explicitly prompt the agent to ask for it before continuing.
{
  const prompt = buildWorkflowRunPrompt(dependent, {
    topic: "OpenCoven release notes",
    audience: "maintainers",
    empty: "",
  });
  assert.match(prompt, /Workflow input/);
  assert.match(prompt, /topic: OpenCoven release notes/);
  assert.match(prompt, /audience: maintainers/);
  assert.doesNotMatch(prompt, /empty:/);
  assert.doesNotMatch(prompt, /If required workflow input is missing/);

  const missing = buildWorkflowRunPrompt(dependent, {});
  assert.match(missing, /Workflow input/);
  assert.match(missing, /No explicit input was provided/);
  assert.match(missing, /If required workflow input is missing, ask Val for the specific value/);
}

// A manifest with no steps still produces a usable prompt (no crash, no step
// block, and no progress markers — there's nothing to track).
{
  const bare: WorkflowSummary = { id: "empty", version: "1.0.0", name: "Empty" };
  assert.deepEqual(orderedWorkflowSteps(bare), []);
  const prompt = buildWorkflowRunPrompt(bare);
  assert.match(prompt, /executing the "Empty" workflow/);
  assert.doesNotMatch(prompt, /Carry out these steps/);
  assert.doesNotMatch(prompt, /@@step-start/);
}

// A workflow with steps exposes each step's id and the progress-marker protocol
// so Cave can map the live transcript back onto the plan.
{
  const prompt = buildWorkflowRunPrompt(dependent);
  assert.match(prompt, /\(id: synth\)/, "each step line shows its id");
  assert.match(prompt, /@@step-start <id>/, "prompt documents the start marker");
  assert.match(prompt, /@@step-done <id>/, "prompt documents the done marker");
  assert.match(prompt, /@@step-fail <id>/, "prompt documents the fail marker");
  // Per-step clarity (mirrors the flow PROGRESS PROTOCOL): a one-line summary
  // note + explicit narration ask so the run's transcript reads clearly.
  assert.match(prompt, /@@step-note <id>/, "prompt documents the per-step summary note");
  assert.match(prompt, /narrate/i, "prompt asks the agent to narrate each step");
}

console.log("workflow-run-prompt.test.ts ✓");
