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
assert.match(source, /action\.id\s*===\s*draft\?\.id/, "Workflows view should scope action state to the selected draft");
assert.match(source, /onSelectNode=\{\(node\)\s*=>\s*setSelectedNodeId\(node\.id\)\}/, "Workflows view should store selected node IDs from Studio");

// --- Studio v2: builder orchestration ---
assert.match(source, /workflowDraftReducer/, "Workflows view should edit through the draft reducer");
assert.match(source, /initialWorkflowDraft/, "Workflows view should seed drafts on selection");
assert.match(source, /workflowToManifest/, "Workflows view should serialize drafts back to manifests");
assert.match(source, /saveWorkflow/, "Workflows view should persist manifests through the save client");
assert.match(source, /deleteWorkflow/, "Workflows view should wire manifest deletion");
assert.match(source, /createWorkflowFromTemplate/, "Workflows view should create workflows from pattern templates");
assert.match(source, /duplicateWorkflow/, "Workflows view should duplicate workflows");
assert.match(source, /runWorkflow/, "Workflows view should probe the daemon run proxy");
assert.match(source, /listWorkflowRuns/, "Workflows view should load run history");
assert.match(source, /recordWorkflowRun/, "Workflows view should snapshot dry-run plans into history");
assert.match(source, /attachWorkflowToRole/, "Workflows view should persist role assignments");
assert.match(source, /scheduleWorkflow/, "Workflows view should schedule reminders");
assert.match(source, /confirmDiscard|Discard unsaved/, "Workflows view should guard unsaved drafts");
assert.match(client, /\/api\/workflows\/save/, "Workflow client should call the save route");
assert.match(client, /\/api\/workflows\/runs/, "Workflow client should call the runs route");
assert.match(client, /\/api\/roles\/workflows/, "Workflow client should call the role-attach route");
assert.match(client, /cave:\/\/workflows\//, "Scheduled reminders should deep-link back to the workflow");

console.log("workflows-view.test.ts: ok");
