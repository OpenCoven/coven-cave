import assert from "node:assert/strict";
import test from "node:test";

import type { ResearchMission, ResearchMissionStatus } from "./research-missions.ts";
import type { ResearchRunStatusV1 } from "./research-protocol/research-run.ts";
import {
  canonicalResearchRunStatusForMission,
  researchMissionLifecycleMatchesRun,
} from "./research-run-lifecycle.ts";

const RUN_STATUSES: ResearchRunStatusV1[] = [
  "queued",
  "scoping",
  "gathering_public_sources",
  "waiting_for_executor",
  "challenging",
  "synthesizing",
  "controlling",
  "awaiting_checkpoint",
  "publishing",
  "completed",
  "failed",
  "cancelled",
  "expired",
];

const MISSION_CASES = [
  { id: "queued", status: "queued" },
  { id: "planning", status: "planning" },
  { id: "running", status: "running" },
  { id: "checkpoint", status: "checkpoint" },
  { id: "paused", status: "paused" },
  { id: "completed", status: "completed" },
  { id: "failed", status: "failed" },
  { id: "cancelled", status: "cancelled" },
  { id: "archived-completed", status: "archived", archivedFrom: "completed" },
  { id: "archived-failed", status: "archived", archivedFrom: "failed" },
  { id: "archived-cancelled", status: "archived", archivedFrom: "cancelled" },
  { id: "archived-checkpoint", status: "archived", archivedFrom: "checkpoint" },
  { id: "archived-paused", status: "archived", archivedFrom: "paused" },
  { id: "archived-unspecified", status: "archived" },
] as const;

const EXPECTED_COMPATIBILITY: Record<ResearchRunStatusV1, ReadonlySet<string>> = {
  queued: new Set(["queued"]),
  scoping: new Set(["planning", "running"]),
  gathering_public_sources: new Set(["running"]),
  waiting_for_executor: new Set(["running"]),
  challenging: new Set(["running"]),
  synthesizing: new Set(["running"]),
  controlling: new Set(["running"]),
  awaiting_checkpoint: new Set(["checkpoint", "paused"]),
  publishing: new Set(["running"]),
  completed: new Set(["completed", "archived-completed"]),
  failed: new Set(["failed", "archived-failed"]),
  cancelled: new Set([
    "cancelled",
    "archived-cancelled",
    "archived-checkpoint",
    "archived-paused",
    "archived-unspecified",
  ]),
  expired: new Set([
    "cancelled",
    "archived-cancelled",
    "archived-checkpoint",
    "archived-paused",
    "archived-unspecified",
  ]),
};

function mission(
  status: ResearchMissionStatus,
  archivedFrom?: ResearchMission["archivedFrom"],
): ResearchMission {
  return {
    version: 1,
    id: "mission-lifecycle",
    familiarId: "familiar-research",
    title: "Lifecycle matrix",
    intent: "Verify lifecycle compatibility.",
    constraints: [],
    mode: "brief",
    modeSource: "user",
    deliverable: "Brief",
    status,
    createdAt: "2026-08-31T18:00:00.000Z",
    updatedAt: "2026-08-31T18:00:00.000Z",
    bounds: {
      maxIterations: 3,
      wallClockMinutes: 30,
      sourceTarget: 5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    iterations: [],
    sources: [],
    artifacts: [],
    ...(archivedFrom ? { archivedFrom } : {}),
  };
}

function runningMissionAt(phase: string): ResearchMission {
  return {
    ...mission("running"),
    iterations: [{
      number: 1,
      status: "running",
      steps: [{
        id: `${phase}-step`,
        type: phase,
        status: "running",
      }],
    }],
  };
}

test("mission/run lifecycle compatibility is exhaustive and fails closed", () => {
  for (const runStatus of RUN_STATUSES) {
    for (const candidate of MISSION_CASES) {
      assert.equal(
        researchMissionLifecycleMatchesRun(
          mission(
            candidate.status,
            "archivedFrom" in candidate ? candidate.archivedFrom : undefined,
          ),
          runStatus,
        ),
        EXPECTED_COMPATIBILITY[runStatus].has(candidate.id),
        `${runStatus} with ${candidate.id}`,
      );
    }
  }

  assert.equal(
    researchMissionLifecycleMatchesRun(
      mission("running"),
      "future_status" as ResearchRunStatusV1,
    ),
    false,
  );
  assert.equal(
    researchMissionLifecycleMatchesRun(
      mission("future_status" as ResearchMissionStatus),
      "synthesizing",
    ),
    false,
  );
});

test("the shared canonical mission mapping preserves gateway lifecycle semantics", () => {
  assert.equal(canonicalResearchRunStatusForMission(mission("queued")), "queued");
  assert.equal(canonicalResearchRunStatusForMission(mission("planning")), "scoping");
  assert.equal(canonicalResearchRunStatusForMission(mission("running")), "synthesizing");
  assert.equal(canonicalResearchRunStatusForMission(runningMissionAt("scope")), "scoping");
  assert.equal(canonicalResearchRunStatusForMission(runningMissionAt("challenge")), "challenging");
  assert.equal(canonicalResearchRunStatusForMission(runningMissionAt("control")), "controlling");
  assert.equal(canonicalResearchRunStatusForMission(mission("checkpoint")), "awaiting_checkpoint");
  assert.equal(canonicalResearchRunStatusForMission(mission("paused")), "awaiting_checkpoint");
  assert.equal(canonicalResearchRunStatusForMission(mission("completed")), "completed");
  assert.equal(canonicalResearchRunStatusForMission(mission("failed")), "failed");
  assert.equal(canonicalResearchRunStatusForMission(mission("cancelled")), "cancelled");
  assert.equal(
    canonicalResearchRunStatusForMission(mission("archived", "completed")),
    "completed",
  );
  assert.equal(
    canonicalResearchRunStatusForMission(mission("archived", "failed")),
    "failed",
  );
  assert.equal(
    canonicalResearchRunStatusForMission(mission("archived", "cancelled")),
    "cancelled",
  );
});
