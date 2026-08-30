import assert from "node:assert/strict";
import test from "node:test";
import type {
  ResearchRunV1,
  RunEventV1,
} from "./research-protocol/research-run.ts";
import {
  consumeResearchRunEvent,
  createResearchRunEventState,
  isCanonicalResearchRunEvent,
  rehydrateResearchRun,
  reduceResearchRunEvent,
  researchRunNeedsResync,
} from "./research-run-event-reducer.ts";

const RUN_ID = "run_reducer_01";
const AT = "2026-08-15T20:00:00.000Z";

const run: ResearchRunV1 = {
  schema: "opencoven.research-run/v1",
  id: RUN_ID,
  acceptedTopic: {
    question: "How should a run resume?",
    editedByUser: false,
  },
  execution: {
    location: "local",
    modelExecution: "cave-device",
    modelBinding: {
      familiarId: "sage",
      selection: "pinned",
      model: "gpt-5.6-sol",
    },
    strategy: "single-agent",
  },
  privacy: {
    remoteQueries: false,
    remoteContent: false,
    artifactContentSync: false,
    retention: "7-days",
    allowMemoryPromotion: false,
  },
  bounds: {
    wallClockMinutes: 45,
    maxIterations: 4,
    sourceTarget: 8,
    checkpointEvery: 2,
    stopWhenCostUnavailable: true,
  },
  status: "queued",
  createdAt: AT,
  updatedAt: AT,
  nextEventSequence: 1,
};

function event(
  sequence: number,
  type: RunEventV1["type"],
  data: Record<string, unknown> = {},
): RunEventV1 {
  return {
    schema: "opencoven.run-event/v1",
    runId: RUN_ID,
    sequence,
    type,
    at: `2026-08-15T20:0${sequence}:00.000Z`,
    data,
  };
}

test("the browser boundary accepts canonical v1 events and rejects malformed frames", () => {
  assert.equal(isCanonicalResearchRunEvent(event(1, "run.created")), true);
  assert.equal(isCanonicalResearchRunEvent({ ...event(1, "run.created"), schema: "opencoven.run-event/v2" }), false);
  assert.equal(isCanonicalResearchRunEvent({ ...event(1, "run.created"), data: [] }), false);
  assert.equal(isCanonicalResearchRunEvent({ ...event(0, "run.created") }), false);
});

test("applies lifecycle, phase, activity, evidence, failure, and retention event data", () => {
  let state = createResearchRunEventState(run);
  state = reduceResearchRunEvent(state, event(1, "run.status", {
    status: "waiting_for_executor",
    waitingReason: "executor",
    waitingForPhase: "challenge",
  }));
  state = reduceResearchRunEvent(state, event(2, "phase.started", {
    phase: "challenge",
    activity: "Comparing primary sources",
    activityDetail: "Reviewing the challenge phase",
    reviewed: 4,
  }));
  state = reduceResearchRunEvent(state, event(3, "phase.completed", {
    phase: "challenge",
    retained: 2,
  }));
  state = reduceResearchRunEvent(state, event(4, "retention.changed", { retention: "project" }));

  assert.equal(state.run.status, "waiting_for_executor");
  assert.equal(state.run.waitingForPhase, "challenge");
  assert.equal(state.phaseStates.challenge, "completed");
  assert.equal(state.activePhase, undefined);
  assert.deepEqual(state.activity, {
    label: "Comparing primary sources",
    detail: "Reviewing the challenge phase",
  });
  assert.deepEqual(state.evidence, { reviewed: 4, retained: 2 });
  assert.equal(state.run.privacy.retention, "project");

  state = reduceResearchRunEvent(state, event(5, "run.failed", {
    code: "provider_timeout",
    message: "The provider timed out",
    retryable: true,
  }));
  assert.equal(state.run.status, "failed");
  assert.deepEqual(state.run.failure, {
    code: "provider_timeout",
    message: "The provider timed out",
    retryable: true,
  });
  assert.equal(state.run.waitingReason, undefined);
  assert.equal(state.run.waitingForPhase, undefined);
});

test("buffers out-of-order events and drains the contiguous prefix when the gap closes", () => {
  const first = event(1, "run.created", { status: "queued" });
  const second = event(2, "phase.started", { phase: "scope" });
  const third = event(3, "phase.completed", { phase: "scope" });

  let state = createResearchRunEventState(run);
  state = reduceResearchRunEvent(state, third);
  assert.equal(state.lastEventSequence, 0);
  assert.deepEqual(state.pendingEvents.map((item) => item.sequence), [3]);
  assert.deepEqual(state.sync, {
    status: "gap",
    expectedSequence: 1,
    receivedSequence: 3,
  });

  state = reduceResearchRunEvent(state, first);
  assert.equal(state.lastEventSequence, 1);
  assert.deepEqual(state.pendingEvents.map((item) => item.sequence), [3]);
  assert.deepEqual(state.sync, {
    status: "gap",
    expectedSequence: 2,
    receivedSequence: 3,
  });

  state = reduceResearchRunEvent(state, second);
  assert.equal(state.lastEventSequence, 3);
  assert.deepEqual(state.pendingEvents, []);
  assert.deepEqual(state.sync, { status: "synced" });
  assert.equal(state.phaseStates.scope, "completed");
  assert.equal(researchRunNeedsResync(state), false);
});

test("identical replay is idempotent while a conflicting same-sequence replay fails closed", () => {
  const first = event(1, "run.status", { status: "scoping" });
  const state = reduceResearchRunEvent(createResearchRunEventState(run), first);
  const duplicate = reduceResearchRunEvent(state, {
    ...first,
    data: { status: "scoping" },
  });
  assert.equal(duplicate, state);
  assert.equal(consumeResearchRunEvent(state, first).disposition, "duplicate");

  const conflict = reduceResearchRunEvent(state, event(1, "run.status", { status: "running" }));
  assert.deepEqual(conflict.sync, { status: "conflict", sequence: 1 });
  assert.equal(conflict.run.status, "scoping");
  assert.equal(researchRunNeedsResync(conflict), true);
});

test("duplicate pending events are ignored and pending conflicts fail closed", () => {
  const first = event(1, "run.created");
  const future = event(3, "phase.completed", { phase: "scope" });
  let state = reduceResearchRunEvent(createResearchRunEventState(run), future);
  const duplicate = reduceResearchRunEvent(state, { ...future, data: { phase: "scope" } });
  assert.equal(duplicate, state);
  state = reduceResearchRunEvent(state, { ...future, data: { phase: "challenge" } });
  assert.deepEqual(state.sync, { status: "conflict", sequence: 3 });
  assert.equal(state.lastEventSequence, 0);
  assert.equal(first.sequence, 1);
});

test("rehydration is deterministic regardless of delivery order", () => {
  const events = [
    event(1, "run.created", { status: "queued" }),
    event(2, "phase.started", { phase: "scope" }),
    event(3, "phase.completed", { phase: "scope" }),
    event(4, "run.completed"),
  ];
  const ordered = rehydrateResearchRun(run, events);
  const shuffled = rehydrateResearchRun(run, [events[2], events[0], events[3], events[1]]);
  assert.deepEqual(shuffled, ordered);
});

test("malformed and cross-run frames are rejected without mutating the projection", () => {
  const initial = createResearchRunEventState(run);
  const malformed = consumeResearchRunEvent(initial, {
    schema: "opencoven.run-event/v1",
    runId: RUN_ID,
    sequence: 1,
    type: "run.created",
    at: AT,
    data: [],
  });
  assert.equal(malformed.disposition, "rejected");
  assert.equal(malformed.state.lastEventSequence, 0);
  assert.equal(malformed.state.sync.status, "invalid");

  const crossRun = consumeResearchRunEvent(initial, { ...event(1, "run.created"), runId: "run_other" });
  assert.equal(crossRun.disposition, "rejected");
  assert.deepEqual(crossRun.state.run, initial.run);
  assert.equal(crossRun.state.sync.status, "invalid");
});
