import assert from "node:assert/strict";
import { flowRunDurationLabel } from "./flow-execution-duration.ts";
import type { FlowRunRecord } from "@/lib/flows";

function run(startedAt: string, finishedAt?: string): FlowRunRecord {
  return {
    id: "run",
    flowId: "flow",
    status: finishedAt ? "succeeded" : "running",
    startedAt,
    finishedAt,
    steps: [],
    source: "cave",
  };
}

assert.equal(
  flowRunDurationLabel(run("2026-06-25T10:00:00.000Z", "2026-06-25T10:00:05.400Z")),
  "5s",
  "sub-minute completed runs render seconds",
);

assert.equal(
  flowRunDurationLabel(run("2026-06-25T10:00:00.000Z", "2026-06-25T10:02:05.000Z")),
  "2m 5s",
  "multi-minute completed runs render minutes and seconds",
);

assert.equal(
  flowRunDurationLabel(run("2026-06-25T10:00:00.000Z"), new Date("2026-06-25T10:01:30.000Z")),
  "1m 30s",
  "running runs use the supplied current time",
);

assert.equal(
  flowRunDurationLabel(run("not a date", "2026-06-25T10:01:30.000Z")),
  null,
  "invalid timestamps do not render a misleading duration",
);

console.log("flow-execution-duration.test.ts OK");
