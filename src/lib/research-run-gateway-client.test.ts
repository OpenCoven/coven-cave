import assert from "node:assert/strict";
import test from "node:test";

import {
  isCanonicalResearchRunSnapshot,
  parseResearchRunGatewaySseFrame,
  researchRunGatewayStreamUrl,
} from "./research-run-gateway-client.ts";
import { consumeResearchRunEvent, createResearchRunEventState } from "./research-run-event-reducer.ts";
import type { ResearchRunV1, RunEventV1 } from "./research-protocol/research-run.ts";

const run: ResearchRunV1 = {
  schema: "opencoven.research-run/v1",
  id: "run_client_01",
  acceptedTopic: { question: "How should the gateway reconnect?", editedByUser: false },
  execution: {
    location: "local",
    modelExecution: "cave-device",
    modelBinding: { familiarId: "sage", selection: "resolve-at-run-start" },
    strategy: "single-agent",
  },
  privacy: {
    remoteQueries: false,
    remoteContent: false,
    artifactContentSync: false,
    retention: "run-only",
    allowMemoryPromotion: false,
  },
  bounds: {
    wallClockMinutes: 10,
    maxIterations: 1,
    sourceTarget: 1,
    checkpointEvery: 1,
    stopWhenCostUnavailable: true,
  },
  status: "scoping",
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  nextEventSequence: 2,
};

const event: RunEventV1 = {
  schema: "opencoven.run-event/v1",
  runId: run.id,
  sequence: 2,
  type: "run.status",
  at: "2026-08-30T12:01:00.000Z",
  data: { status: "synthesizing", sources: 2 },
};

test("client accepts snapshot frames and applies canonical events through the reducer", () => {
  assert.equal(isCanonicalResearchRunSnapshot(run), true);
  const snapshot = parseResearchRunGatewaySseFrame("snapshot", JSON.stringify({
    run,
    lastEventSequence: 1,
    nextEventSequence: 2,
    afterSeq: 1,
  }));
  assert.equal(snapshot?.kind, "snapshot");
  const state = createResearchRunEventState(run);
  const consumed = consumeResearchRunEvent(state, event);
  assert.equal(consumed.disposition, "applied");
  assert.equal(consumed.state.run.status, "synthesizing");
});

test("malformed, wrong-run, and gap frames fail closed", () => {
  const malformed = parseResearchRunGatewaySseFrame("run-event", "{\"data\":[]}");
  assert.equal(malformed?.kind, "error");
  const wrongRun = { ...event, runId: "run_other" };
  const state = createResearchRunEventState(run);
  const consumed = consumeResearchRunEvent(state, wrongRun);
  assert.equal(consumed.disposition, "rejected");
  assert.equal(consumed.state.sync.status, "invalid");
  const future = { ...event, sequence: 4 };
  const buffered = consumeResearchRunEvent(state, future);
  assert.equal(buffered.disposition, "buffered");
  assert.equal(buffered.state.sync.status, "gap");
});

test("stream URLs carry familiar ownership and the requested replay cursor", () => {
  assert.equal(
    researchRunGatewayStreamUrl("gateway-01", "sage", 12),
    "/api/research/runs/gateway-01/stream?familiarId=sage&afterSeq=12",
  );
});
