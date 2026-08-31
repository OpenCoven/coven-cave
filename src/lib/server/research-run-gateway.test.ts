import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "node:fs";

import type { ResearchMission } from "../research-missions.ts";
import {
  createResearchMissionWorkspace,
  saveResearchMission,
} from "./research-mission-store.ts";
import { withResearchMissionActionLock } from "./research-mission-lock.ts";
import {
  loadResearchRunGateway,
  replayResearchRunGateway,
  researchMissionToCanonicalRun,
} from "./research-run-gateway.ts";
import * as researchRunGateway from "./research-run-gateway.ts";

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

test("archived missions preserve a durable completed outcome", () => {
  const completed = researchMissionToCanonicalRun({
    ...mission("gateway-archived-completed", "archived"),
    archivedFrom: "completed",
    finishedAt: "2026-08-30T12:10:00.000Z",
    iterations: [{
      number: 1,
      status: "completed",
      finishedAt: "2026-08-30T12:10:00.000Z",
    }],
  }, 1);
  assert.equal(completed.status, "completed");
  assert.equal(completed.legacyMissionStatus, "archived");
});

test("archived missions preserve a durable failed outcome", () => {
  const failed = researchMissionToCanonicalRun({
    ...mission("gateway-archived-failed", "archived"),
    archivedFrom: "failed",
    lastError: "Provider exhausted its retry budget",
    iterations: [{
      number: 1,
      status: "failed",
      finishedAt: "2026-08-30T12:10:00.000Z",
    }],
  }, 1);
  assert.equal(failed.status, "failed");
  assert.equal(failed.legacyMissionStatus, "archived");
  assert.equal(failed.failure?.code, "research_mission_failed");
});

test("archiving a pause between completed iterations is cancelled, not completed", () => {
  const paused = researchMissionToCanonicalRun({
    ...mission("gateway-archived-paused", "archived"),
    archivedFrom: "paused",
    iterations: [{
      number: 1,
      status: "completed",
      finishedAt: "2026-08-30T12:10:00.000Z",
    }],
  }, 1);
  assert.equal(paused.status, "cancelled");
  assert.equal(paused.legacyMissionStatus, "archived");
});

test("legacy archive after Continue then cancellation never fabricates completion", async () => {
  const legacy = {
    ...mission("gateway-legacy-cancelled", "archived"),
    finishedAt: "2026-08-30T12:20:00.000Z",
    iterations: [
      {
        number: 1,
        status: "completed" as const,
        finishedAt: "2026-08-30T12:10:00.000Z",
      },
      {
        number: 2,
        status: "cancelled" as const,
        finishedAt: "2026-08-30T12:20:00.000Z",
      },
    ],
    artifacts: [{
      key: "primary",
      kind: "brief" as const,
      title: "Published first iteration",
      relativePath: "artifacts/primary.md",
      iteration: 1,
      state: "published" as const,
      updatedAt: "2026-08-30T12:10:00.000Z",
    }],
  };

  const projected = researchMissionToCanonicalRun(legacy, 1);
  assert.equal(projected.status, "cancelled");

  await createResearchMissionWorkspace(legacy);
  const replay = await replayResearchRunGateway(legacy.id, 0, 20);
  assert.ok(replay);
  assert.equal(replay.run.status, "cancelled");
  assert.equal(replay.events.some((event) => event.type === "run.completed"), false);
  assert.equal(replay.events.at(-1)?.type, "run.cancelled");
});

test("archived missions without terminal evidence map to cancelled", () => {
  const nonterminal = researchMissionToCanonicalRun(
    mission("gateway-archived-planning", "archived"),
    1,
  );
  assert.equal(nonterminal.status, "cancelled");
});

test("subscription is active during the authoritative initial read and closes on failure", async () => {
  const subscribeBeforeInitialRead = (
    researchRunGateway as Record<string, unknown>
  ).subscribeBeforeInitialResearchRunRead;
  assert.equal(typeof subscribeBeforeInitialRead, "function");

  const order: string[] = [];
  const subscription: { notify?: () => void } = {};
  let invalidations = 0;
  let stopped = 0;
  const read = subscribeBeforeInitialRead as <T>(
    subscribe: (onChange: () => void) => () => void,
    onChange: () => void,
    initialRead: () => Promise<T>,
  ) => Promise<{ value: T; activate: () => void; stopWatching: () => void }>;
  const opened = await read(
    (onChange) => {
      order.push("watch");
      subscription.notify = onChange;
      return () => { stopped += 1; };
    },
    () => { invalidations += 1; },
    async () => {
      order.push("read");
      subscription.notify?.();
      return "snapshot";
    },
  );
  assert.deepEqual(order, ["watch", "read"]);
  assert.equal(invalidations, 0, "updates during the initial read stay buffered");
  opened.activate();
  assert.equal(invalidations, 1);
  subscription.notify?.();
  assert.equal(invalidations, 2, "updates after activation publish immediately");
  assert.equal(opened.value, "snapshot");
  opened.stopWatching();
  assert.equal(stopped, 1);

  await assert.rejects(read(
    () => () => { stopped += 1; },
    () => {},
    async () => {
      throw new Error("initial read failed");
    },
  ), /initial read failed/);
  assert.equal(stopped, 2);
});

test("gateway sync rereads the mission under the action lock before appending", async () => {
  const syncObservedMission = (
    researchRunGateway as Record<string, unknown>
  ).syncObservedMission;
  assert.equal(typeof syncObservedMission, "function");

  const missionId = "gateway-concurrent-terminal";
  let authoritativeMission = mission(missionId, "running");
  let loadCalls = 0;
  let log: {
    version: 1;
    runId: string;
    events: Array<{ type: string; sequence: number }>;
    projection?: { status: string; missionUpdatedAt: string };
  } | null = null;
  let releaseBlocker = () => {};
  let markEntered = () => {};
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const release = new Promise<void>((resolve) => { releaseBlocker = resolve; });
  const blocker = withResearchMissionActionLock(missionId, async () => {
    markEntered();
    await release;
  });
  await entered;

  const syncing = (syncObservedMission as (
    id: string,
    deps: {
      loadMission: (id: string) => Promise<ResearchMission | null>;
      loadEventLog: (runId: string) => Promise<typeof log>;
      appendEventsWithinMissionLock: (
        runId: string,
        events: Array<{ type: string; sequence: number }>,
        projection: { status: string; missionUpdatedAt: string },
      ) => Promise<NonNullable<typeof log>>;
    },
  ) => Promise<{ mission: ResearchMission; log: NonNullable<typeof log> } | null>)(
    missionId,
    {
      loadMission: async () => {
        loadCalls += 1;
        return structuredClone(authoritativeMission);
      },
      loadEventLog: async () => structuredClone(log),
      appendEventsWithinMissionLock: async (runId, events, projection) => {
        log = { version: 1, runId, events: structuredClone(events), projection };
        return structuredClone(log);
      },
    },
  );

  await Promise.resolve();
  assert.equal(loadCalls, 0, "the mission read must wait behind the action lock");
  authoritativeMission = {
    ...authoritativeMission,
    status: "completed",
    updatedAt: "2026-08-30T12:10:00.000Z",
    finishedAt: "2026-08-30T12:10:00.000Z",
  };
  releaseBlocker();
  await blocker;

  const synced = await syncing;
  assert.ok(synced);
  assert.equal(synced.mission.status, "completed");
  assert.equal(synced.log.projection?.status, "completed");
  assert.deepEqual(
    synced.log.events.map((event) => event.type),
    ["run.created", "run.completed"],
  );
});

test("watch setup exceptions fail the subscription and close watchers already opened", () => {
  class FakeWatcher extends EventEmitter {
    closed = false;
    close() {
      this.closed = true;
    }
  }
  const opened = new FakeWatcher();
  let calls = 0;
  assert.throws(
    () => researchRunGateway.watchResearchRunSources(
      "gateway-watch-setup",
      () => {},
      () => {},
      {
        existsSync: () => true,
        watch: () => {
          calls += 1;
          if (calls === 1) return opened as unknown as FSWatcher;
          throw new Error("watch setup unavailable");
        },
      },
    ),
    /watch setup unavailable/,
  );
  assert.equal(opened.closed, true);
});

test("a later watcher error stops every watcher and signals the SSE owner", () => {
  class FakeWatcher extends EventEmitter {
    closed = false;
    close() {
      this.closed = true;
    }
  }
  const watchers = [new FakeWatcher(), new FakeWatcher()];
  let nextWatcher = 0;
  const failures: Error[] = [];
  const stop = researchRunGateway.watchResearchRunSources(
    "gateway-watch-error",
    () => {},
    (error) => failures.push(error as Error),
    {
      existsSync: () => true,
      watch: () => watchers[nextWatcher++] as unknown as FSWatcher,
    },
  );

  watchers[1].emit("error", new Error("watcher lost"));
  assert.deepEqual(failures.map((error) => error.message), ["watcher lost"]);
  assert.equal(watchers.every((watcher) => watcher.closed), true);
  stop();
  assert.deepEqual(failures.map((error) => error.message), ["watcher lost"]);
});

test("invalid mission ids cannot be projected", () => {
  assert.throws(
    () => researchMissionToCanonicalRun(mission("bad/id"), 1),
    /invalid research mission id/i,
  );
});
