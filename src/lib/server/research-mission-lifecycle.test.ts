import assert from "node:assert/strict";
import test from "node:test";
import { parseResearchMission } from "../research-missions.ts";
import { applyStartResult, createMissionRecord } from "./research-mission-lifecycle.ts";

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

test("createMissionRecord persists the surface that invoked the run", () => {
  // The origin has to reach the durable record, and survive re-reading it:
  // this is the only field that lets the Research Desk and chat agree they are
  // looking at the same run (#4808), and it is written exactly once, here.
  const fromChat = createMissionRecord(
    { ...INPUT, origin: { surface: "chat", sessionId: "conv-42" } },
    "mission-chat",
    new Date("2026-07-24T00:00:00.000Z"),
  );
  assert.deepEqual(fromChat.origin, { surface: "chat", sessionId: "conv-42" });
  assert.deepEqual(parseResearchMission(fromChat)?.origin, { surface: "chat", sessionId: "conv-42" });

  // A caller that names no origin gets none — never a guessed one.
  const anonymous = createMissionRecord(INPUT, "mission-anon", new Date("2026-07-24T00:00:00.000Z"));
  assert.equal(anonymous.origin, undefined);
  assert.equal(parseResearchMission(anonymous)?.origin, undefined);
});

test("createMissionRecord records whether the mission title was explicit or generated", () => {
  const explicit = createMissionRecord(INPUT, "mission-explicit", new Date("2026-07-24T00:00:00.000Z"));
  const generated = createMissionRecord(
    { ...INPUT, title: undefined },
    "mission-generated",
    new Date("2026-07-24T00:00:00.000Z"),
  );
  assert.equal(explicit.titleSource, "explicit");
  assert.equal(generated.titleSource, "generated");
});

test("applyStartResult keeps private process-owner provenance out of mission state", () => {
  const mission = createMissionRecord(INPUT, "mission-1", new Date("2026-07-24T00:00:00.000Z"));
  const sessionAuthority = {
    kind: "owner-local-daemon" as const,
    socketPath: "/tmp/coven-launch.sock",
  };
  const started = applyStartResult(mission, {
    ok: true,
    executor: "session",
    sessionId: "session-1",
    sessionAuthority,
    sessionOwnerKind: "owner-local-daemon",
  }, new Date("2026-07-24T00:01:00.000Z"));
  assert.equal("sessionAuthority" in (started.iterations[0] ?? {}), false);
  assert.equal("sessionOwnerKind" in (started.iterations[0] ?? {}), false);

  const retained = applyStartResult(mission, {
    ok: false,
    sessionId: "session-2",
    sessionAuthority,
    sessionOwnerKind: "owner-local-daemon",
    cleanupUnconfirmed: true,
    error: "cleanup uncertain",
  }, new Date("2026-07-24T00:01:00.000Z"));
  assert.equal("sessionAuthority" in (retained.iterations[0] ?? {}), false);
  assert.equal("sessionOwnerKind" in (retained.iterations[0] ?? {}), false);
});
