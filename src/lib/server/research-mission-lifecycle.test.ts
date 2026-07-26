import assert from "node:assert/strict";
import test from "node:test";
import { createMissionRecord } from "./research-mission-lifecycle.ts";

const INPUT = {
  familiarId: "sage",
  title: "Storage decision",
  intent: "Compare SQLite and Postgres",
  mode: "sweep" as const,
  modeSource: "user" as const,
  deliverable: "report",
  constraints: [],
  bounds: {
    wallClockMinutes: 20,
    maxIterations: 1,
    sourceTarget: 6,
    checkpointEvery: 1,
    stopWhenCostUnavailable: false,
  },
};

test("createMissionRecord registers the primary and all standard artifact refs", () => {
  const mission = createMissionRecord(INPUT, "mission-1", new Date("2026-07-24T00:00:00.000Z"));
  assert.deepEqual(
    mission.artifacts.map((artifact) => [artifact.key, artifact.kind, artifact.relativePath]),
    [
      ["primary", "report", "artifacts/primary.md"],
      ["findings", "findings", "findings.md"],
      ["source-ledger", "source-ledger", "sources.json"],
      ["research-log", "research-log", "research-log.md"],
    ],
  );
  for (const artifact of mission.artifacts) {
    assert.equal(artifact.state, "working");
    assert.equal(artifact.iteration, 1);
    assert.equal(artifact.updatedAt, "2026-07-24T00:00:00.000Z");
    assert.equal(artifact.knowledgeId, undefined);
  }
});
