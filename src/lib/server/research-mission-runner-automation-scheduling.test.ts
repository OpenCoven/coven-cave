import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationFile } from "../cave-conversations.ts";
import type { AutomationRunRecord } from "../automation-runs.ts";
import type { FlowRunRecord } from "../flows.ts";
import { allowedResearchActions, type ResearchMission } from "../research-missions.ts";
import {
  makeResearchMissionRunner,
  parseResearchSourcesFile,
  sessionAlreadyGone,
  withinStartupGrace,
  type ResearchMissionRunnerDeps,
} from "./research-mission-runner.ts";

const NOW = new Date("2026-07-12T12:00:00.000Z");
const RUN: FlowRunRecord = {
  id: "run-1",
  flowId: "research-mission-1-iteration-1",
  flowName: "Research",
  status: "running",
  startedAt: NOW.toISOString(),
  steps: [],
  source: "cave",
  sessionId: "session-1",
};

const INPUT = {
  familiarId: "sage",
  title: "Storage decision",
  intent: "Compare SQLite and Postgres",
  mode: "brief" as const,
  modeSource: "user" as const,
  deliverable: "brief",
  constraints: [],
  bounds: {
    wallClockMinutes: 20,
    maxIterations: 1,
    sourceTarget: 6,
    checkpointEvery: 1,
    stopWhenCostUnavailable: false,
  },
};

function deps(overrides: Partial<ResearchMissionRunnerDeps> = {}): ResearchMissionRunnerDeps {
  return {
    createWorkspace: async (mission) => mission,
    loadMission: async () => null,
    saveMission: async () => {},
    startFlow: async () => ({
      ok: true,
      run: RUN,
      sessionId: "session-1",
      executor: "session",
    }),
    loadFlowRun: async () => null,
    loadConversation: async () => null,
    sessionState: async () => "unknown",
    readSessionTranscript: async () => "",
    readMissionFile: async () => null,
    readSources: async () => [],
    publishKnowledge: async (entry) => entry,
    killSession: async () => {},
    createAutomation: async (input) => ({
      id: "automation-1",
      status: "PAUSED",
      rrule: input.rrule,
    }),
    updateAutomation: async (id, patch) => ({
      id,
      status: patch.status ?? "PAUSED",
      rrule: null,
    }),
    getAutomation: async () => null,
    latestAutomationRun: async () => null,
    readAutomationTranscript: async () => "",
    readAutomationCheckpoint: async () => ({ transcript: "", token: "", at: NOW.toISOString() }),
    fingerprintMission: async () => "checkpoint-before",
    missionWorkspacePath: (id) => `/tmp/research-missions/${id}`,
    resolveProjectRoot: async (root) => root,
    now: () => NOW,
    randomId: () => "mission-1",
    ...overrides,
  };
}

function checkpointMission(overrides: Partial<ResearchMission> = {}): ResearchMission {
  return {
    version: 1,
    id: "mission-actions",
    familiarId: "sage",
    title: "Iterative research",
    intent: "Investigate a changing field",
    mode: "autoresearch",
    modeSource: "user",
    deliverable: "findings",
    constraints: [],
    bounds: {
      wallClockMinutes: 240,
      maxIterations: 3,
      sourceTarget: 12,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "checkpoint",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    iterations: [{
      number: 1,
      status: "checkpoint",
      flowRunId: "run-1",
      sessionId: "session-1",
      startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
      decision: "checkpoint",
      decisionReason: "Review before continuing",
    }],
    artifacts: [{
      key: "primary",
      kind: "findings",
      title: "Iterative research",
      relativePath: "artifacts/primary.md",
      iteration: 1,
      state: "working",
      updatedAt: NOW.toISOString(),
    }],
    sources: [],
    ...overrides,
  };
}
test("schedule creates a standard paused Codex Automation bound to the mission workspace", async () => {
  let stored = checkpointMission();
  const automationInputs: Array<Parameters<ResearchMissionRunnerDeps["createAutomation"]>[0]> = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    createAutomation: async (input) => {
      automationInputs.push(input);
      return { id: "automation-1", status: "PAUSED", rrule: input.rrule };
    },
  }));
  const result = await runner.schedule(stored.id, {
    rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  });
  assert.equal(result.automation?.id, "automation-1");
  assert.equal(result.automation?.status, "PAUSED");
  assert.deepEqual(automationInputs[0]?.tags, [
    "research-mission",
    `research-mission:${stored.id}`,
  ]);
  assert.deepEqual(automationInputs[0]?.cwds, [
    `/tmp/research-missions/${stored.id}`,
  ]);
  assert.match(automationInputs[0]?.prompt ?? "", /exactly one bounded research iteration/i);
  assert.match(automationInputs[0]?.prompt ?? "", /^@@research-control$/m);
  assert.match(automationInputs[0]?.prompt ?? "", /^@@research-artifacts-written$/m);
});

test("automation reconciliation pauses on a missing checkpoint and dedupes the run", async () => {
  const run: AutomationRunRecord = {
    id: "automation-run-1",
    automationId: "automation-1",
    automationName: "Research mission",
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    status: "succeeded",
  };
  let stored = checkpointMission({
    automation: {
      id: "automation-1",
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      status: "ACTIVE",
      checkpointFingerprint: "checkpoint-before",
    },
  });
  const updates: Array<{ id: string; status?: string }> = [];
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => { stored = structuredClone(mission); },
    latestAutomationRun: async () => run,
    readAutomationTranscript: async () => "run completed without control output",
    fingerprintMission: async () => "checkpoint-after",
    updateAutomation: async (id, patch) => {
      updates.push({ id, status: patch.status });
      return { id, status: patch.status ?? "PAUSED", rrule: null };
    },
  }));
  const first = await runner.reconcileAutomation(stored);
  const second = await runner.reconcileAutomation(first);
  assert.equal(first.automation?.status, "PAUSED");
  assert.equal(first.automation?.lastRunId, run.id);
  assert.equal(first.iterations.length, 1);
  assert.match(first.lastError ?? "", /control checkpoint/i);
  assert.equal(second.iterations.length, 1);
  assert.deepEqual(updates, [{ id: "automation-1", status: "PAUSED" }]);
});

test("automation reconciliation mirrors status changes made through the standard API", async () => {
  let stored = checkpointMission({
    automation: {
      id: "automation-1",
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      status: "ACTIVE",
      checkpointFingerprint: "checkpoint-before",
    },
  });
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => { stored = structuredClone(mission); },
    getAutomation: async () => ({ id: "automation-1", status: "PAUSED", rrule: stored.automation!.rrule }),
  }));
  const result = await runner.reconcileAutomation(stored);
  assert.equal(result.automation?.status, "PAUSED");
});

test("a scheduler-owned Codex run is reconciled from its changed workspace checkpoint", async () => {
  let stored = checkpointMission({
    automation: {
      id: "automation-1",
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      status: "ACTIVE",
      checkpointFingerprint: "checkpoint-before",
      checkpointToken: "checkpoint-empty",
    },
  });
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readAutomationCheckpoint: async () => ({
      transcript: [
        "2026-07-12T13:00:00.000Z",
        "@@research-control",
        '{"decision":"checkpoint","reason":"Scheduled evidence gathered","confidence":0.7}',
        "@@research-artifacts-written",
      ].join("\n"),
      token: "checkpoint-scheduled-1",
      at: "2026-07-12T13:00:00.000Z",
    }),
    fingerprintMission: async () => "checkpoint-after",
  }));
  const result = await runner.reconcileAutomation(stored);
  assert.equal(result.iterations.length, 2);
  assert.equal(result.iterations[1].automationRunId, "scheduled-checkpoint-scheduled-1");
  assert.equal(result.automation?.checkpointToken, "checkpoint-scheduled-1");
});

test("one changed automation checkpoint becomes one iteration and pauses at the finite limit", async () => {
  const run: AutomationRunRecord = {
    id: "automation-run-2",
    automationId: "automation-1",
    automationName: "Research mission",
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    status: "succeeded",
  };
  let stored = checkpointMission({
    bounds: { ...checkpointMission().bounds, maxIterations: 2 },
    automation: {
      id: "automation-1",
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      status: "ACTIVE",
      checkpointFingerprint: "checkpoint-before",
    },
  });
  const updates: Array<{ id: string; status?: string }> = [];
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => { stored = structuredClone(mission); },
    latestAutomationRun: async () => run,
    readAutomationTranscript: async () => [
      "@@research-control",
      '{"decision":"checkpoint","reason":"More evidence remains","confidence":0.8}',
      "@@research-artifacts-written",
    ].join("\n"),
    fingerprintMission: async () => "checkpoint-after",
    readMissionFile: async () => "# Bounded evidence\n",
    updateAutomation: async (id, patch) => {
      updates.push({ id, status: patch.status });
      return { id, status: patch.status ?? "PAUSED", rrule: null };
    },
  }));
  const first = await runner.reconcileAutomation(stored);
  const second = await runner.reconcileAutomation(first);
  assert.equal(first.iterations.length, 2);
  assert.equal(first.iterations[1].automationRunId, run.id);
  assert.equal(first.iterations[1].decision, "checkpoint");
  assert.equal(first.status, "completed");
  assert.equal(first.automation?.status, "PAUSED");
  assert.match(first.automation?.stopReason ?? "", /Iteration limit reached/);
  assert.equal(second.iterations.length, 2);
  assert.deepEqual(updates, [{ id: "automation-1", status: "PAUSED" }]);
});

test("terminal mission actions pause a linked active Automation", async () => {
  for (const action of ["finish", "cancel", "archive"] as const) {
    let stored = checkpointMission({
      automation: {
        id: "automation-1",
        rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        status: "ACTIVE",
        checkpointFingerprint: "before",
      },
    });
    const updates: string[] = [];
    const runner = makeResearchMissionRunner(deps({
      loadMission: async () => structuredClone(stored),
      saveMission: async (mission) => { stored = structuredClone(mission); },
      updateAutomation: async (id, patch) => {
        updates.push(`${id}:${patch.status}`);
        return { id, status: patch.status ?? "PAUSED", rrule: null };
      },
    }));
    const result = await runner.act(stored.id, { action });
    assert.equal(result.automation?.status, "PAUSED", action);
    assert.deepEqual(updates, ["automation-1:PAUSED"], action);
  }
});

test("checkpoint cadence pauses scheduled continuation for human review", async () => {
  const run: AutomationRunRecord = {
    id: "automation-run-checkpoint",
    automationId: "automation-1",
    automationName: "Research mission",
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    status: "succeeded",
  };
  let stored = checkpointMission({
    bounds: { ...checkpointMission().bounds, checkpointEvery: 1 },
    automation: {
      id: "automation-1",
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      status: "ACTIVE",
      checkpointFingerprint: "before",
    },
  });
  const updates: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => { stored = structuredClone(mission); },
    latestAutomationRun: async () => run,
    readAutomationTranscript: async () => [
      "@@research-control",
      '{"decision":"checkpoint","reason":"Review evidence","confidence":0.8}',
      "@@research-artifacts-written",
    ].join("\n"),
    fingerprintMission: async () => "after",
    readMissionFile: async () => "# Working evidence\n",
    updateAutomation: async (id, patch) => {
      updates.push(`${id}:${patch.status}`);
      return { id, status: patch.status ?? "PAUSED", rrule: null };
    },
  }));
  const result = await runner.reconcileAutomation(stored);
  assert.equal(result.status, "checkpoint");
  assert.equal(result.automation?.status, "PAUSED");
  assert.match(result.automation?.stopReason ?? "", /Checkpoint review required/);
  assert.deepEqual(updates, ["automation-1:PAUSED"]);
});

test("checkpoint cadence also pauses when the agent requests continue", async () => {
  const run: AutomationRunRecord = {
    id: "automation-run-continue",
    automationId: "automation-1",
    automationName: "Research mission",
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    status: "succeeded",
  };
  let stored = checkpointMission({
    bounds: { ...checkpointMission().bounds, checkpointEvery: 1 },
    automation: {
      id: "automation-1",
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      status: "ACTIVE",
      checkpointFingerprint: "before",
    },
  });
  const updates: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => { stored = structuredClone(mission); },
    latestAutomationRun: async () => run,
    readAutomationTranscript: async () => [
      "@@research-control",
      '{"decision":"continue","reason":"More remains","confidence":0.8}',
      "@@research-artifacts-written",
    ].join("\n"),
    fingerprintMission: async () => "after",
    readMissionFile: async () => "# Working evidence\n",
    updateAutomation: async (id, patch) => {
      updates.push(`${id}:${patch.status}`);
      return { id, status: patch.status ?? "PAUSED", rrule: null };
    },
  }));
  const result = await runner.reconcileAutomation(stored);
  assert.equal(result.status, "checkpoint");
  assert.equal(result.automation?.status, "PAUSED");
  assert.deepEqual(updates, ["automation-1:PAUSED"]);
});

test("terminal actions pause Automation truth even when mission metadata is stale", async () => {
  let stored = checkpointMission({
    automation: {
      id: "automation-1",
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      status: "PAUSED",
      checkpointFingerprint: "before",
    },
  });
  const updates: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    getAutomation: async () => ({ id: "automation-1", status: "ACTIVE", rrule: stored.automation!.rrule }),
    updateAutomation: async (id, patch) => {
      updates.push(`${id}:${patch.status}`);
      return { id, status: patch.status ?? "PAUSED", rrule: null };
    },
  }));
  const result = await runner.act(stored.id, { action: "finish" });
  assert.equal(result.automation?.status, "PAUSED");
  assert.deepEqual(updates, ["automation-1:PAUSED"]);
});


