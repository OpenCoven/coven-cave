import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { ResearchMission } from "../research-missions.ts";
import {
  createResearchMissionWorkspace,
  saveResearchMission,
} from "./research-mission-store.ts";
import {
  loadResearchRunGateway,
  replayResearchRunGateway,
  researchMissionToCanonicalRun,
} from "./research-run-gateway.ts";

const originalMissionRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
const originalEventRoot = process.env.COVEN_RESEARCH_RUN_EVENTS_DIR;
const originalLockRoot = process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR;
const root = path.join(process.cwd(), `.research-run-gateway-${process.pid}`);

function mission(id: string, status: ResearchMission["status"] = "planning"): ResearchMission {
  return {
    version: 1,
    id,
    familiarId: "sage",
    title: "Gateway mission",
    intent: "Compare the persisted research approaches",
    mode: "brief",
    modeSource: "user",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 2,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    },
    harness: "copilot",
    model: "gpt-5.6-sol",
    status,
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-30T12:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
  };
}

before(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(root, "missions");
  process.env.COVEN_RESEARCH_RUN_EVENTS_DIR = path.join(root, "events");
  process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = path.join(root, "locks");
});

after(async () => {
  if (originalMissionRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
  else process.env.COVEN_RESEARCH_MISSIONS_DIR = originalMissionRoot;
  if (originalEventRoot === undefined) delete process.env.COVEN_RESEARCH_RUN_EVENTS_DIR;
  else process.env.COVEN_RESEARCH_RUN_EVENTS_DIR = originalEventRoot;
  if (originalLockRoot === undefined) delete process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR;
  else process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = originalLockRoot;
  await rm(root, { recursive: true, force: true });
});

test("projects the mission source into a validated canonical run and observes real transitions", async () => {
  await createResearchMissionWorkspace(mission("gateway-projection"));
  const first = await loadResearchRunGateway("gateway-projection");
  assert.ok(first);
  assert.equal(first.run.id, "run_gateway-projection");
  assert.equal(first.run.status, "scoping");
  assert.equal(first.lastEventSequence, 2);
  assert.equal(first.run.nextEventSequence, 3);
  assert.equal(first.run.privacy.remoteContent, false);

  await saveResearchMission({
    ...mission("gateway-projection", "running"),
    updatedAt: "2026-08-30T12:01:00.000Z",
  });
  const second = await replayResearchRunGateway("gateway-projection", 2, 20);
  assert.ok(second);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0]?.type, "run.status");
  assert.equal(second.events[0]?.data.status, "synthesizing");
  assert.equal(second.events[0]?.data.prompt, undefined);
});

test("terminal legacy status receives a metadata-only final manifest", () => {
  const run = researchMissionToCanonicalRun(
    mission("gateway-completed", "completed"),
    1,
  );
  assert.equal(run.status, "completed");
  assert.equal(run.artifactManifest?.state, "final");
  assert.deepEqual(run.artifactManifest?.sources, []);
  assert.deepEqual(run.artifactManifest?.artifacts, []);
});

test("invalid mission ids cannot be projected", () => {
  assert.throws(
    () => researchMissionToCanonicalRun(mission("bad/id"), 1),
    /invalid research mission id/i,
  );
});
