import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  enqueueManualEvalGroupRun,
  listEvalGroups,
  listManualEvalQueue,
  listThreadEvalSnapshots,
  saveEvalGroup,
  saveThreadEvalSnapshot,
} from "./eval-store.ts";
import type { EvalGroup, ThreadEvalSnapshot, ThreadEvalState } from "../evals/eval-model.ts";

let tempRoot = "";
const previousDir = process.env.COVEN_EVALS_DIR;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cave-evals-"));
  process.env.COVEN_EVALS_DIR = tempRoot;
});

afterEach(async () => {
  if (previousDir === undefined) delete process.env.COVEN_EVALS_DIR;
  else process.env.COVEN_EVALS_DIR = previousDir;
  await rm(tempRoot, { recursive: true, force: true });
});

function group(overrides: Partial<EvalGroup> = {}): EvalGroup {
  return {
    id: overrides.id ?? "group-1",
    name: overrides.name ?? "Current Thread Confidence",
    description: overrides.description,
    scope: overrides.scope ?? "thread",
    members: overrides.members ?? [{ kind: "thread", id: "thread-1", familiarId: "cody" }],
    tracks: overrides.tracks ?? ["confidence"],
    rubricVersion: overrides.rubricVersion ?? "rubric-v1",
    stalePolicy: overrides.stalePolicy ?? { ttlMs: 60_000 },
    schedulePolicy: overrides.schedulePolicy ?? { mode: "manual" },
    createdAt: overrides.createdAt ?? "2026-06-28T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-28T08:00:00.000Z",
  };
}

function snapshot(overrides: Partial<ThreadEvalSnapshot> = {}): ThreadEvalSnapshot {
  return {
    threadId: overrides.threadId ?? "thread-1",
    familiarId: overrides.familiarId ?? "cody",
    evalGroupId: overrides.evalGroupId,
    evaluatedThroughTurnId: overrides.evaluatedThroughTurnId ?? "turn-2",
    inputHash: overrides.inputHash ?? "hash-a",
    rubricVersion: overrides.rubricVersion ?? "rubric-v1",
    confidenceRubricVersion: overrides.confidenceRubricVersion ?? "confidence-v1",
    skillsVersion: overrides.skillsVersion ?? "skills-v1",
    permissionsHash: overrides.permissionsHash ?? "perms-v1",
    responseConfidenceEventIds: overrides.responseConfidenceEventIds ?? ["confidence-1"],
    evaluatedAt: overrides.evaluatedAt ?? "2026-06-28T08:00:00.000Z",
  };
}

describe("eval store groups and thread state", () => {
  it("saves and lists eval groups newest first", async () => {
    await saveEvalGroup(group({ id: "old", updatedAt: "2026-06-28T08:00:00.000Z" }));
    await saveEvalGroup(group({ id: "new", updatedAt: "2026-06-28T09:00:00.000Z" }));

    const groups = await listEvalGroups();

    assert.deepEqual(groups.map((item) => item.id), ["new", "old"]);
    assert.equal(groups[0].schedulePolicy.mode, "manual");
  });

  it("saves and lists thread eval snapshots newest first", async () => {
    await saveThreadEvalSnapshot(snapshot({ threadId: "thread-old", evaluatedAt: "2026-06-28T08:00:00.000Z" }));
    await saveThreadEvalSnapshot(snapshot({ threadId: "thread-new", evaluatedAt: "2026-06-28T09:00:00.000Z" }));

    const snapshots = await listThreadEvalSnapshots();

    assert.deepEqual(snapshots.map((item) => item.threadId), ["thread-new", "thread-old"]);
  });

  it("queues manual eval group runs for runnable thread states", async () => {
    const states: ThreadEvalState[] = [
      {
        threadId: "thread-1",
        familiarId: "cody",
        status: "stale",
        staleReasons: ["new-turns"],
        evaluatedAt: "2026-06-28T08:00:00.000Z",
        details: { responseConfidenceEventCount: 0, snapshotResponseConfidenceEventCount: 0 },
      },
      {
        threadId: "thread-2",
        familiarId: "cody",
        status: "blocked",
        staleReasons: ["eval-lock-stale"],
        evaluatedAt: "2026-06-28T08:00:00.000Z",
        details: { responseConfidenceEventCount: 0, snapshotResponseConfidenceEventCount: 0 },
      },
    ];

    const queued = await enqueueManualEvalGroupRun(group(), states, "2026-06-28T08:15:00.000Z");
    const listed = await listManualEvalQueue();

    assert.equal(queued.length, 1);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].threadId, "thread-1");
    assert.deepEqual(listed[0].staleReasons, ["new-turns"]);
  });

  it("sanitizes eval group tracks before queueing request-derived groups", async () => {
    const states: ThreadEvalState[] = [
      {
        threadId: "thread-1",
        familiarId: "cody",
        status: "stale",
        staleReasons: ["confidence-events-added"],
        evaluatedAt: "2026-06-28T08:00:00.000Z",
        details: { responseConfidenceEventCount: 2, snapshotResponseConfidenceEventCount: 1 },
      },
    ];
    const unsafeGroup = group({
      tracks: ["confidence", "bad-track", "memory"] as unknown as EvalGroup["tracks"],
    });

    const queued = await enqueueManualEvalGroupRun(unsafeGroup, states, "2026-06-28T08:15:00.000Z");

    assert.deepEqual(queued[0].tracks, ["confidence", "memory"]);
  });
});
