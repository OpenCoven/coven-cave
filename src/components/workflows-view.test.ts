// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workflows-view.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/workflows.ts", import.meta.url), "utf8");

assert.match(source, /export function WorkflowsView/, "Cave should expose a first-class Workflows view");
assert.match(source, /import\s+\{\s*WorkflowStudio/, "Workflows view should import WorkflowStudio");
assert.match(source, /<WorkflowStudio\b/, "Workflows view should render WorkflowStudio as the container");

assert.match(source, /selectedWorkflowId/, "Workflows view should track selected workflow ID state");
assert.match(source, /selectedNodeId/, "Workflows view should track selected graph node ID state");
assert.match(
  source,
  /selectedGraph\?\.nodes\.find\(\(node\)\s*=>\s*node\.id\s*===\s*selectedNodeId\)\s*\?\?\s*null/,
  "Workflows view should derive the selected node from the current graph",
);

assert.match(source, /listWorkflows/, "Workflows view should load manifests through the Cave workflow client");
assert.match(client, /\/api\/workflows/, "Workflows view should stay behind Cave API proxy routes");
assert.match(source, /validateWorkflow/, "Workflows view should wire validation through the workflow client");
assert.match(source, /dryRunWorkflow/, "Workflows view should wire dry-run through the workflow client");
assert.match(source, /workflowToGraph/, "Workflows view should derive selected graph data with workflowToGraph");
assert.match(source, /action\?\.id\s*===\s*selectedWorkflow\?\.id/, "Workflows view should scope action state to the selected workflow");
assert.match(source, /onSelectNode=\{\(node\)\s*=>\s*setSelectedNodeId\(node\.id\)\}/, "Workflows view should store selected node IDs from Studio");

console.log("workflows-view.test.ts: ok");
