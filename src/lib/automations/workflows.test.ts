// @ts-nocheck
import assert from "node:assert/strict";

const {
  workflowDetailPath,
  listWorkflows,
  validateWorkflow,
  dryRunWorkflow,
  workflowIssueSummary,
  workflowRunBlockReason,
  workflowInputSteps,
  workflowOutputSteps,
} = await import("./workflows.ts");

// I/O contract gate: needs both an input and an output node to be runnable.
{
  const wf = (steps) => ({ id: "w", version: "1", steps });
  assert.match(
    workflowRunBlockReason(wf([{ id: "a", kind: "agent" }])),
    /input node and an output node/,
    "no I/O nodes ⇒ blocked for both",
  );
  assert.match(
    workflowRunBlockReason(wf([{ id: "i", kind: "input" }, { id: "a", kind: "agent" }])),
    /output node/,
    "input only ⇒ blocked on output",
  );
  assert.match(
    workflowRunBlockReason(wf([{ id: "a", kind: "agent" }, { id: "o", kind: "output" }])),
    /input node/,
    "output only ⇒ blocked on input",
  );
  assert.equal(
    workflowRunBlockReason(wf([{ id: "i", kind: "input" }, { id: "o", kind: "output" }])),
    null,
    "input + output ⇒ runnable",
  );
  assert.equal(workflowRunBlockReason(null), "Select a workflow first.", "null workflow is blocked");
  const both = wf([{ id: "i", kind: "input" }, { id: "a", kind: "agent" }, { id: "o", kind: "output" }]);
  assert.equal(workflowInputSteps(both).length, 1, "finds the input node");
  assert.equal(workflowOutputSteps(both).length, 1, "finds the output node");
}

{
  assert.equal(
    workflowDetailPath("cody review/pr"),
    "/api/workflows/cody%20review%2Fpr",
    "workflow detail paths must URL-encode workflow ids",
  );
}

{
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      json: async () => ({ ok: true, workflows: [{ id: "cody-review-pr", version: "1.0.0" }] }),
    };
  };
  const result = await listWorkflows(fakeFetch);
  assert.deepEqual(calls, [{ url: "/api/workflows", init: { cache: "no-store" } }]);
  assert.equal(result.workflows[0].id, "cody-review-pr");
}

{
  const calls = [];
  const body = { path: "/tmp/cody-review-pr.workflow.yaml" };
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { json: async () => ({ ok: false, issues: [{ code: "workflow.required_limits", tier: "schema" }] }) };
  };
  const result = await validateWorkflow(body, fakeFetch);
  assert.equal(calls[0].url, "/api/workflows/validate");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify(body));
  assert.equal(result.issues[0].code, "workflow.required_limits");
}

{
  const calls = [];
  const body = { id: "cody-review-pr", inputs: { pr_url: "https://github.com/OpenCoven/coven/pull/1" } };
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { json: async () => ({ ok: true, workflowId: "cody-review-pr", steps: [], estimates: { maxAgents: 2 } }) };
  };
  const result = await dryRunWorkflow(body, fakeFetch);
  assert.equal(calls[0].url, "/api/workflows/dry-run");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(result.workflowId, "cody-review-pr");
}

{
  assert.equal(workflowIssueSummary([]), "No validation issues");
  assert.equal(
    workflowIssueSummary([
      { code: "workflow.schema", tier: "schema" },
      { code: "workflow.preflight", tier: "preflight" },
      { code: "workflow.semantic", tier: "semantic" },
      { code: "workflow.schema.other", tier: "schema" },
    ]),
    "2 schema, 1 semantic, 1 preflight",
  );
}

console.log("workflows.test.ts: ok");
