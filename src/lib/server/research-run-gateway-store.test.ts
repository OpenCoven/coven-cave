import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ResearchMission } from "../research-missions.ts";
import {
  appendResearchRunEvents,
  loadResearchRunEventLog,
  replayResearchRunEvents,
  type ResearchRunObservedProjection,
} from "./research-run-gateway-store.ts";
import { researchMissionToCanonicalRun } from "./research-run-gateway.ts";

const originalMissionRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
const originalEventRoot = process.env.COVEN_RESEARCH_RUN_EVENTS_DIR;
const originalLockRoot = process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR;
const root = path.join(process.cwd(), `.research-run-gateway-store-${process.pid}`);
const runId = "run_gateway-store";
const projection: ResearchRunObservedProjection = {
  status: "scoping",
  missionUpdatedAt: "2026-08-30T12:00:00.000Z",
  iterationCount: 0,
  sourceCount: 0,
  artifactCount: 3,
};

function event(sequence: number) {
  return {
    schema: "opencoven.run-event/v1" as const,
    runId,
    sequence,
    type: "run.status" as const,
    at: "2026-08-30T12:00:00.000Z",
    data: {
      status: "scoping",
      artifacts: 3,
      iterations: 0,
    },
  };
}

function finalizedRun(missionId: string, nextEventSequence: number) {
  const completed: ResearchMission = {
    version: 1,
    id: missionId,
    familiarId: "sage",
    title: "Finalized run",
    intent: "Persist an immutable finalized manifest",
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
    status: "completed",
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-30T12:01:00.000Z",
    finishedAt: "2026-08-30T12:01:00.000Z",
    iterations: [{
      number: 1,
      status: "completed",
      finishedAt: "2026-08-30T12:01:00.000Z",
    }],
    artifacts: [],
    sources: [],
  };
  return researchMissionToCanonicalRun(completed, nextEventSequence);
}

before(async () => {
  await rm(root, { recursive: true, force: true });
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

test("appends contiguous events atomically and replays after a requested sequence", async () => {
  await appendResearchRunEvents(runId, [event(1)], projection);
  const second = {
    ...event(2),
    data: { status: "synthesizing", sources: 4, artifacts: 3, iterations: 1 },
  };
  await appendResearchRunEvents(runId, [second], {
    ...projection,
    status: "synthesizing",
    missionUpdatedAt: "2026-08-30T12:01:00.000Z",
    iterationCount: 1,
    sourceCount: 4,
  });

  const loaded = await loadResearchRunEventLog(runId);
  assert.equal(loaded?.events.length, 2);
  assert.deepEqual(replayResearchRunEvents(loaded!, 1, 10), {
    events: [second],
    hasMore: false,
    lastEventSequence: 2,
  });

  // A same-sequence exact replay is idempotent; a conflicting replay cannot
  // rewrite the canonical event history.
  await appendResearchRunEvents(runId, [second]);
  await assert.rejects(
    appendResearchRunEvents(runId, [{ ...second, data: { status: "failed" } }]),
    /conflicts with the durable ledger/i,
  );
});

test("gaps, unsafe fields, and future cursors fail closed", async () => {
  await assert.rejects(
    appendResearchRunEvents("run_gateway-gap", [{ ...event(2), runId: "run_gateway-gap" }]),
    /sequence must equal 1/i,
  );
  await assert.rejects(
    appendResearchRunEvents("run_gateway-unsafe", [{
      ...event(1),
      runId: "run_gateway-unsafe",
      data: { prompt: "must not reach the gateway" },
    }]),
    /not safe/i,
  );
  const loaded = await loadResearchRunEventLog(runId);
  assert.ok(loaded);
  assert.throws(
    () => replayResearchRunEvents(loaded, 99, 10),
    /ahead of the durable ledger/i,
  );
});

test("malformed durable logs are rejected instead of repaired or served", async () => {
  const eventRoot = path.join(root, "events");
  await mkdir(eventRoot, { recursive: true });
  await writeFile(path.join(eventRoot, "run_gateway-malformed.json"), "{\"version\":1}", "utf8");
  await assert.rejects(
    loadResearchRunEventLog("run_gateway-malformed"),
    /event log is malformed/i,
  );
  const raw = await readFile(path.join(eventRoot, "run_gateway-malformed.json"), "utf8");
  assert.equal(raw, "{\"version\":1}");
});

test("append rejects a serialized log over 4 MiB without replacing the readable ledger", async () => {
  const boundedRunId = "run_gateway-byte-bound";
  const maximumBytes = 4 * 1024 * 1024;
  const candidates = Array.from({ length: 20_000 }, (_, index) => ({
    ...event(index + 1),
    runId: boundedRunId,
    data: {
      status: "scoping",
      message: "x".repeat(256),
    },
  }));
  const bytesFor = (events: typeof candidates) => Buffer.byteLength(JSON.stringify({
    version: 1,
    runId: boundedRunId,
    events,
  }, null, 2), "utf8");

  let low = 1;
  let high = candidates.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bytesFor(candidates.slice(0, middle)) <= maximumBytes) low = middle;
    else high = middle - 1;
  }
  const belowLimit = candidates.slice(0, low);
  const crossingEvent = candidates[low];
  assert.ok(crossingEvent, "the event-count limit must leave room to cross the byte limit");
  assert.ok(bytesFor(belowLimit) <= maximumBytes);
  assert.ok(bytesFor([...belowLimit, crossingEvent]) > maximumBytes);

  await appendResearchRunEvents(boundedRunId, belowLimit);
  const before = await readFile(path.join(root, "events", `${boundedRunId}.json`), "utf8");
  assert.ok(Buffer.byteLength(before, "utf8") <= maximumBytes);

  await assert.rejects(
    appendResearchRunEvents(boundedRunId, [crossingEvent]),
    /event log is too large/i,
  );
  assert.equal(
    await readFile(path.join(root, "events", `${boundedRunId}.json`), "utf8"),
    before,
  );
  assert.equal((await loadResearchRunEventLog(boundedRunId))?.events.length, belowLimit.length);
});

test("append cannot reopen a terminal Research Run ledger", async () => {
  const terminalRunId = "run_gateway-terminal";
  const created = {
    ...event(1),
    runId: terminalRunId,
    type: "run.created" as const,
    data: {},
  };
  const completed = {
    ...event(2),
    runId: terminalRunId,
    type: "run.completed" as const,
    at: "2026-08-30T12:01:00.000Z",
    data: { status: "completed" },
  };
  await appendResearchRunEvents(terminalRunId, [created, completed], {
    ...projection,
    status: "completed",
  }, finalizedRun("gateway-terminal", 3).artifactManifest);

  await assert.rejects(
    appendResearchRunEvents(terminalRunId, [{
      ...event(3),
      runId: terminalRunId,
      data: { status: "scoping" },
    }], {
      ...projection,
      status: "scoping",
      missionUpdatedAt: "2026-08-30T12:01:00.000Z",
    }),
    /terminal run event/i,
  );
  const unchanged = await loadResearchRunEventLog(terminalRunId);
  assert.deepEqual(unchanged?.events.map((entry) => entry.type), [
    "run.created",
    "run.completed",
  ]);
  assert.equal(unchanged?.projection?.status, "completed");
});

test("terminal append atomically persists one immutable finalized manifest", async () => {
  const terminalRunId = "run_gateway-finalized";
  const created = {
    ...event(1),
    runId: terminalRunId,
    type: "run.created" as const,
    data: {},
  };
  const completed = {
    ...event(2),
    runId: terminalRunId,
    type: "run.completed" as const,
    at: "2026-08-30T12:01:00.000Z",
    data: { status: "completed" },
  };
  const finalized = finalizedRun("gateway-finalized", 3);

  await assert.rejects(
    appendResearchRunEvents(terminalRunId, [created, completed], {
      ...projection,
      status: "completed",
      missionUpdatedAt: "2026-08-30T12:01:00.000Z",
    }),
    /finalized run manifest is required/i,
  );
  assert.equal(await loadResearchRunEventLog(terminalRunId), null);

  await appendResearchRunEvents(terminalRunId, [created, completed], {
    ...projection,
    status: "completed",
    missionUpdatedAt: "2026-08-30T12:01:00.000Z",
  }, finalized.artifactManifest);
  const first = await loadResearchRunEventLog(terminalRunId);
  assert.deepEqual(first?.finalManifest, finalized.artifactManifest);

  await appendResearchRunEvents(terminalRunId, [], {
    ...projection,
    status: "completed",
    missionUpdatedAt: "2026-08-30T12:05:00.000Z",
  });
  const afterAdministration = await loadResearchRunEventLog(terminalRunId);
  assert.deepEqual(afterAdministration?.finalManifest, finalized.artifactManifest);
  assert.equal(
    afterAdministration?.finalManifest?.digest,
    finalized.artifactManifest?.digest,
  );
  assert.equal(
    afterAdministration?.finalManifest?.finalizedAt,
    "2026-08-30T12:01:00.000Z",
  );
});
