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

// A manifest with no steps still produces a usable prompt (no crash, no step block).
{
  const bare: WorkflowSummary = { id: "empty", version: "1.0.0", name: "Empty" };
  assert.deepEqual(orderedWorkflowSteps(bare), []);
  const prompt = buildWorkflowRunPrompt(bare);
  assert.match(prompt, /executing the "Empty" workflow/);
  assert.doesNotMatch(prompt, /Carry out these steps/);
}

console.log("workflow-run-prompt.test.ts ✓");
