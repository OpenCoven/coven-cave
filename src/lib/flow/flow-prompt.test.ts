import assert from "node:assert/strict";
import { buildPromptFlow, flowNameFromPrompt } from "./flow-prompt.ts";

const NOW = "2026-06-24T12:00:00.000Z";

{
  assert.equal(flowNameFromPrompt("  summarize unread PRs and draft follow-up  "), "Summarize unread PRs and draft follow-up");
  assert.equal(flowNameFromPrompt("triage inbox\nthen create tasks"), "Triage inbox");
  assert.equal(flowNameFromPrompt(""), "Prompt flow");
}

{
  const doc = buildPromptFlow("flow-prs", "summarize unread PRs and draft follow-up", NOW);
  assert.equal(doc.id, "flow-prs");
  assert.equal(doc.name, "Summarize unread PRs and draft follow-up");
  assert.equal(doc.nodes.length, 2, "prompt-created flows start with a trigger and familiar step");
  assert.equal(doc.edges.length, 1, "prompt-created flows wire the trigger into the familiar step");
  assert.equal(doc.nodes[0]?.type, "trigger.manual");
  assert.equal(doc.nodes[1]?.type, "familiar");
  assert.equal(doc.nodes[1]?.params.prompt, "summarize unread PRs and draft follow-up");
  assert.equal(doc.edges[0]?.source, doc.nodes[0]?.id);
  assert.equal(doc.edges[0]?.target, doc.nodes[1]?.id);
}

console.log("flow-prompt.test.ts OK");
