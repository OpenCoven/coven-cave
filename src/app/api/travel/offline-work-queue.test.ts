import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowRunRoute = await readFile(new URL("../workflows/run/route.ts", import.meta.url), "utf8");
const flowExecutor = await readFile(new URL("../../../lib/server/flow-executor.ts", import.meta.url), "utf8");
const automationRunRoute = await readFile(
  new URL("../codex-automations/[id]/run/route.ts", import.meta.url),
  "utf8",
);
const travelHelper = await readFile(new URL("../../../lib/travel-offline-queue.ts", import.meta.url), "utf8");
const flows = await readFile(new URL("../../../lib/flows.ts", import.meta.url), "utf8");
const flowFilters = await readFile(new URL("../../../lib/flow/flow-execution-filters.ts", import.meta.url), "utf8");
const automationRuns = await readFile(new URL("../../../lib/automation-runs.ts", import.meta.url), "utf8");
const automationsView = await readFile(new URL("../../../components/automations-view.tsx", import.meta.url), "utf8");
const runStatusColorHelper = await readFile(new URL("../../../lib/automations/run-status.ts", import.meta.url), "utf8");

assert.match(
  travelHelper,
  /deriveTravelClientStatus\(\{[\s\S]*hubReachable: state\.travel\.hubUnreachableSince \? false : null/,
  "Travel queue helper should respect recorded hub outages without probing inline",
);
assert.match(
  travelHelper,
  /return status\.authority === "travel-local" \? status : null/,
  "Only travel-local authority should divert work into the offline queue",
);

assert.match(workflowRunRoute, /travelLocalQueueStatus\(config\)/, "Workflow runs should check travel-local authority");
assert.match(workflowRunRoute, /enqueueOfflineTravelItem\(\{[\s\S]*kind: "workflow"/, "Workflow runs should queue workflow work");
assert.match(workflowRunRoute, /status:\s*"queued"/, "Workflow run history should show queued offline runs");
assert.match(workflowRunRoute, /executor:\s*"travel-queue"/, "Workflow queue responses should name the travel queue executor");
assert.ok(
  workflowRunRoute.indexOf("const offlineWorkflowResponse = await maybeQueueOfflineWorkflow") <
    workflowRunRoute.indexOf("path: \"/api/v1/workflows/run\""),
  "Workflow queueing should run before daemon engine calls",
);

assert.match(flowExecutor, /travelLocalQueueStatus\(config\)/, "Flow execution should check travel-local authority");
assert.match(flowExecutor, /enqueueOfflineTravelItem\(\{[\s\S]*kind: "workflow"/, "Flow execution should queue workflow work");
assert.match(flowExecutor, /status:\s*"queued"/, "Flow run history should show queued offline runs");
assert.match(flowExecutor, /executor:\s*"travel-queue"/, "Flow queue responses should name the travel queue executor");
assert.ok(
  flowExecutor.indexOf("const travelStatus = await travelLocalQueueStatus(config)") <
    flowExecutor.indexOf("path: \"/api/v1/sessions\""),
  "Flow queueing should run before daemon session spawning",
);

assert.match(automationRunRoute, /travelLocalQueueStatus\(config\)/, "Automation jobs should check travel-local authority");
assert.match(automationRunRoute, /enqueueOfflineTravelItem\(\{[\s\S]*kind: "job"/, "Automation jobs should queue job work");
assert.match(automationRunRoute, /status:\s*"queued"/, "Automation run history should show queued offline jobs");
assert.match(automationRunRoute, /executor:\s*"travel-queue"/, "Automation queue responses should name the travel queue executor");
assert.ok(
  automationRunRoute.indexOf("const travelStatus = await travelLocalQueueStatus(config)") <
    automationRunRoute.indexOf("startAutomationRun(auto)"),
  "Automation queueing should run before codex exec spawning",
);

assert.match(flows, /FlowRunStatus = "preview" \| "queued" \| "running"/, "Flow run type should include queued");
assert.match(flowFilters, /\{ value: "queued", label: "Queued" \}/, "Flow execution filters should expose queued runs");
assert.match(automationRuns, /AutomationRunStatus = "queued" \| "running"/, "Automation run type should include queued");
assert.match(automationsView, /runStatusColor\(r\.status\)/, "Automation run rows should tint runs via the shared runStatusColor helper");
assert.match(runStatusColorHelper, /case "queued":\s*\n\s*return "var\(--color-warning\)"/, "runStatusColor should tint queued jobs with the warning color");

console.log("offline-work-queue.test.ts: ok");
