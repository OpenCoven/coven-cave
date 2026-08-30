import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  appendResearchRunEvents,
  loadResearchRunEventLog,
  replayResearchRunEvents,
  type ResearchRunObservedProjection,
} from "./research-run-gateway-store.ts";

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
