import assert from "node:assert/strict";
import {
  FLOW_EXECUTION_STARTED_FILTERS,
  filterFlowRuns,
  type FlowExecutionStartedFilter,
} from "./flow-execution-filters.ts";
import type { FlowRunRecord } from "@/lib/flows";

function run(
  id: string,
  status: FlowRunRecord["status"],
  startedAt: string,
  customData?: FlowRunRecord["customData"],
): FlowRunRecord {
  return {
    id,
    flowId: "flow",
    status,
    startedAt,
    steps: [],
    source: "cave",
    customData,
  };
}

const now = new Date("2026-06-25T16:30:00.000Z");
const runs = [
  run("recent-failed", "failed", "2026-06-25T16:00:00.000Z", { priority: "critical", customer: "OpenCoven" }),
  run("today-success", "succeeded", "2026-06-25T14:00:00.000Z", { priority: "normal" }),
  run("week-preview", "preview", "2026-06-21T12:00:00.000Z", { customer: "OpenCoven" }),
  run("old-running", "running", "2026-06-10T12:00:00.000Z"),
];

assert.deepEqual(
  FLOW_EXECUTION_STARTED_FILTERS.map((filter) => filter.value),
  ["any", "hour", "today", "week"] satisfies FlowExecutionStartedFilter[],
  "started filters should cover all, last hour, today, and seven days",
);

assert.deepEqual(
  filterFlowRuns(runs, { status: "all", started: "hour", now }).map((item) => item.id),
  ["recent-failed"],
  "last-hour filter keeps only executions started in the last hour",
);

assert.deepEqual(
  filterFlowRuns(runs, { status: "all", started: "today", now }).map((item) => item.id),
  ["recent-failed", "today-success"],
  "today filter keeps executions from the current calendar day",
);

assert.deepEqual(
  filterFlowRuns(runs, { status: "all", started: "week", now }).map((item) => item.id),
  ["recent-failed", "today-success", "week-preview"],
  "seven-day filter keeps executions inside the rolling week",
);

assert.deepEqual(
  filterFlowRuns(runs, { status: "failed", started: "today", now }).map((item) => item.id),
  ["recent-failed"],
  "status and started filters combine",
);

assert.deepEqual(
  filterFlowRuns(runs, { status: "all", started: "any", customKey: "customer", customValue: "OpenCoven", now }).map((item) => item.id),
  ["recent-failed", "week-preview"],
  "custom data key/value filter matches saved execution data",
);

assert.deepEqual(
  filterFlowRuns(runs, { status: "failed", started: "today", customKey: "priority", customValue: "critical", now }).map((item) => item.id),
  ["recent-failed"],
  "custom data combines with status and start filters",
);

console.log("flow-execution-filters.test.ts OK");
