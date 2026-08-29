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
const automationRuns = await readFile(new URL("../../../lib/automation-runs.ts", import.meta.url), "utf8");
const automationsView = [
  await readFile(new URL("../../../components/automations-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("../../../components/automations/cron-detail-panel.tsx", import.meta.url), "utf8"),
].join("\n");
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

// cave-4990: the run route no longer enqueues offline work itself — it
// dispatches through the Coven automations facade (runRoutine). Jobs queued by
// an offline session replay through travel-offline-replay (which also calls
// runRoutine), and a daemon that is still offline degrades to 503 instead of
// falling back to codex exec.
assert.match(automationRunRoute, /runRoutine\(id\)/, "Automation runs should dispatch through the Coven automations facade");
assert.match(automationRunRoute, /outcome\.status === "failed"/, "Automation run failures should surface as a failed run outcome");
assert.match(automationRunRoute, /CovenAutomationsUnavailableError[\s\S]*degraded: true[\s\S]*status: 503/, "An offline automations daemon should degrade to 503");
assert.doesNotMatch(automationRunRoute, /startAutomationRun/, "Automation runs must not fall back to the retired Codex runner");
assert.doesNotMatch(automationRunRoute, /enqueueOfflineTravelItem/, "The run route must not enqueue offline work — queued jobs replay through travel-offline-replay");

assert.match(flows, /FlowRunStatus = "preview" \| "queued" \| "running"/, "Flow run type should include queued");
assert.match(automationRuns, /AutomationRunStatus = "queued" \| "running"/, "Automation run type should include queued");
assert.match(automationsView, /runStatusColor\(r\.status\)/, "Automation run rows should tint runs via the shared runStatusColor helper");
assert.match(runStatusColorHelper, /case "queued":\s*\n\s*return "var\(--color-warning\)"/, "runStatusColor should tint queued jobs with the warning color");

console.log("offline-work-queue.test.ts: ok");
