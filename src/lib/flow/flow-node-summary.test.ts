// @ts-nocheck
import assert from "node:assert/strict";
import { flowNodeSummary } from "./flow-node-summary.ts";

const node = (type, params = {}) => ({
  id: "n1",
  type,
  name: type,
  position: { x: 0, y: 0 },
  params,
});

// Every configured node type yields a one-line, human-scannable summary.
assert.equal(flowNodeSummary(node("trigger.schedule", { mode: "cron", cron: "0 9 * * 1" })), "cron 0 9 * * 1");
assert.equal(flowNodeSummary(node("trigger.schedule", { mode: "interval", everyMinutes: 30 })), "every 30m");
assert.equal(flowNodeSummary(node("trigger.webhook", { method: "POST", path: "/hooks/deploy" })), "POST /hooks/deploy");
assert.equal(flowNodeSummary(node("trigger.chat", { familiar: "sage" })), "as sage");
assert.equal(flowNodeSummary(node("familiar", { familiar: "cody", prompt: "Review the diff" })), "cody — Review the diff");
assert.equal(flowNodeSummary(node("familiar", { familiar: "cody" })), "cody");
assert.equal(flowNodeSummary(node("ai.classify", { familiar: "sage", categories: "bug, feature" })), "sage · bug, feature");
assert.equal(flowNodeSummary(node("skill", { skill: "summarize", input: "the PR" })), "summarize — the PR");
assert.equal(flowNodeSummary(node("mcp", { server: "github", tool: "create_issue" })), "github · create_issue");
assert.equal(flowNodeSummary(node("http", { method: "GET", url: "https://api.example.com/v1" })), "GET https://api.example.com/v1");
assert.equal(flowNodeSummary(node("code", { language: "python" })), "python");
assert.equal(flowNodeSummary(node("logic.if", { condition: "score > 3" })), "score > 3");
assert.equal(flowNodeSummary(node("logic.switch", { rules: '[{"a":1},{"b":2}]' })), "2 rules");
assert.equal(flowNodeSummary(node("logic.wait", { seconds: 15 })), "15s");
assert.equal(flowNodeSummary(node("logic.loop", { batchSize: 5 })), "batches of 5");
assert.equal(flowNodeSummary(node("data.set", { fields: '{"x":1}' })), "1 field");
assert.equal(flowNodeSummary(node("data.execution", { key: "score", value: "0.9" })), "score = 0.9");
assert.equal(flowNodeSummary(node("human.gate", { prompt: "Approve the release?" })), "Approve the release?");

// Unconfigured / no-param types stay quiet — the card falls back to type only.
assert.equal(flowNodeSummary(node("trigger.manual")), null);
assert.equal(flowNodeSummary(node("familiar")), null);
assert.equal(flowNodeSummary(node("http", { method: "GET" })), null, "an http node without a URL has nothing worth showing");
assert.equal(flowNodeSummary(node("logic.switch", { rules: "not json" })), null, "a draft rules value doesn't throw");
assert.equal(flowNodeSummary(node("sticky")), null);

console.log("flow-node-summary.test.ts: ok");
