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

test("sources file parsing rejects malformed ledgers", () => {
  assert.throws(() => parseResearchSourcesFile("not json"), /sources\.json is malformed/);
  assert.throws(() => parseResearchSourcesFile("{}"), /sources\.json must contain an array/);
  assert.throws(() => parseResearchSourcesFile('[{"id":"bad"}]'), /sources\.json source 1/);
});

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

test("create/start persists before launch and records the real session", async () => {
  const calls: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    createWorkspace: async (mission) => {
      calls.push("create");
      return mission;
    },
    saveMission: async () => {
      calls.push("save");
    },
    startFlow: async () => {
      calls.push("start");
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));
  const result = await runner.createAndStart(INPUT);
  assert.deepEqual(calls, ["create", "save", "start", "save"]);
  assert.equal(result.iterations[0].sessionId, "session-1");
  assert.equal(result.iterations[0].flowRunId, "run-1");
  assert.equal(result.status, "running");
});

test("launch failure remains persisted and retryable", async () => {
  const saved: ResearchMission[] = [];
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => {
      saved.push(structuredClone(mission));
    },
    startFlow: async () => ({ ok: false, error: "daemon offline", unavailable: true }),
  }));
  const result = await runner.createAndStart(INPUT);
  assert.equal(result.status, "failed");
  assert.equal(result.lastError, "daemon offline");
  assert.ok(allowedResearchActions(result).includes("retry"));
  assert.equal(saved.at(-1)?.status, "failed");
});

test("the default project root is the pre-resolved mission workspace", async () => {
  const roots: Array<string | null> = [];
  const runner = makeResearchMissionRunner(deps({
    resolveProjectRoot: async (root) => `/resolved${root}`,
    startFlow: async (_flow, options) => {
      roots.push(options.projectRoot);
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));
  const result = await runner.createAndStart(INPUT);
  assert.deepEqual(roots, ["/resolved/tmp/research-missions/mission-1"]);
  assert.equal(result.status, "running");
});

test("an unallowed configured project root fails fast with an actionable error", async () => {
  let starts = 0;
  const runner = makeResearchMissionRunner(deps({
    resolveProjectRoot: async () => null,
    startFlow: async () => {
      starts += 1;
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));
  const result = await runner.createAndStart({ ...INPUT, projectRoot: "/missing/repo" });
  assert.equal(starts, 0, "no session may launch against an invalid project root");
  assert.equal(result.status, "failed");
  assert.match(result.lastError ?? "", /"\/missing\/repo" is not an allowed project path/);
  assert.match(result.lastError ?? "", /mission workspace/);
  assert.ok(allowedResearchActions(result).includes("retry"));
});

test("travel launch remains honestly queued", async () => {
  const runner = makeResearchMissionRunner(deps({
    startFlow: async () => ({
      ok: true,
      queued: true,
      executor: "travel-queue",
      run: { ...RUN, status: "queued", sessionId: undefined },
    }),
  }));
  const result = await runner.createAndStart(INPUT);
  assert.equal(result.status, "queued");
  assert.equal(result.iterations[0].status, "queued");
});

test("running reconciliation carries real Flow phase progress", async () => {
  const runner = makeResearchMissionRunner(deps({
    loadFlowRun: async () => ({
      ...RUN,
      steps: [
        { id: "scope", type: "familiar", status: "succeeded", detail: "Question framed" },
        { id: "gather", type: "familiar", status: "running" },
      ],
    }),
  }));
  const started = await runner.createAndStart(INPUT);
  const result = await runner.reconcile(started);
  assert.deepEqual(result.iterations[0].steps, [
    { id: "scope", type: "familiar", status: "succeeded", detail: "Question framed" },
    { id: "gather", type: "familiar", status: "running" },
  ]);
});

test("successful evidence reconciliation publishes one provenance-rich artifact", async () => {
  const published: string[] = [];
  const conversation = {
    sessionId: "session-1",
    familiarId: "sage",
    harness: "codex",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    turns: [{
      id: "turn-1",
      role: "assistant",
      text: [
        "@@research-control",
        '{"decision":"complete","reason":"Enough evidence","confidence":0.9}',
        "@@research-artifacts-written",
      ].join("\n"),
      createdAt: NOW.toISOString(),
    }],
  } satisfies ConversationFile;
  const runner = makeResearchMissionRunner(deps({
    loadFlowRun: async () => ({ ...RUN, status: "succeeded", finishedAt: NOW.toISOString() }),
    loadConversation: async () => conversation,
    readMissionFile: async (_id, relativePath) =>
      relativePath === "artifacts/primary.md" ? "# Evidence-backed answer\n" : null,
    readSources: async () => [{
      id: "source-1",
      title: "Primary source",
      url: "https://example.com/source",
      sourceType: "web",
      status: "used",
    }],
    publishKnowledge: async (entry) => {
      published.push(entry.body);
      return entry;
    },
  }));
  const started = await runner.createAndStart(INPUT);
  const result = await runner.reconcile(started);
  assert.equal(result.status, "completed");
  assert.equal(result.artifacts[0].state, "published");
  assert.equal(result.sources.length, 1);
  assert.equal(published.length, 1);
  assert.match(published[0], /mission: mission-1/);
  assert.match(published[0], /# Evidence-backed answer/);
});

test("two Continue calls create exactly one next iteration", async () => {
  let stored = checkpointMission();
  let starts = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async (flow) => {
      starts += 1;
      return {
        ok: true,
        executor: "session",
        sessionId: "session-2",
        run: { ...RUN, id: "run-2", flowId: flow.id, sessionId: "session-2" },
      };
    },
  }));
  const [a, b] = await Promise.all([
    runner.act(stored.id, { action: "continue" }),
    runner.act(stored.id, { action: "continue" }),
  ]);
  assert.equal(a.iterations.length, 2);
  assert.equal(b.iterations.length, 2);
  assert.equal(starts, 1);
});

test("cost-unavailable policy pauses before another iteration", async () => {
  let stored = checkpointMission({
    bounds: {
      ...checkpointMission().bounds,
      stopWhenCostUnavailable: true,
    },
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
  }));
  const result = await runner.act(stored.id, { action: "continue" });
  assert.equal(result.status, "paused");
  assert.match(result.lastError ?? "", /Cost unavailable/);
});

test("cancel kills the active session and preserves artifacts", async () => {
  const killed: string[] = [];
  let stored = checkpointMission({
    status: "running",
    iterations: [{
      ...checkpointMission().iterations[0],
      status: "running",
      finishedAt: undefined,
    }],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    killSession: async (sessionId) => { killed.push(sessionId); },
  }));
  const result = await runner.act(stored.id, { action: "cancel" });
  assert.deepEqual(killed, ["session-1"]);
  assert.equal(result.status, "cancelled");
  assert.equal(result.artifacts.length, 1);
});

test("manual sources normalize, dedupe, and remain revisable", async () => {
  let stored = checkpointMission();
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
  }));
  await runner.act(stored.id, {
    action: "attach-source",
    source: { id: "manual-1", title: "Spec", url: "https://example.com/spec", status: "candidate" },
  });
  await runner.act(stored.id, {
    action: "attach-source",
    source: { id: "manual-2", title: "Duplicate", url: "https://example.com/spec", status: "used" },
  });
  const result = await runner.act(stored.id, {
    action: "update-source",
    sourceId: "manual-1",
    patch: { status: "conflicting", note: "Different target cohort" },
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].status, "conflicting");
  assert.equal(result.sources[0].note, "Different target cohort");
});

test("artifact rejection preserves the file reference and refine starts once", async () => {
  let stored = checkpointMission();
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async () => ({
      ok: true,
      executor: "session",
      sessionId: "session-2",
      run: { ...RUN, id: "run-2", sessionId: "session-2" },
    }),
  }));
  const rejected = await runner.act(stored.id, {
    action: "reject-artifact",
    artifactKey: "primary",
    reason: "Needs a narrower comparison set",
  });
  assert.equal(rejected.artifacts[0].state, "rejected");
  assert.match(rejected.artifacts[0].rejectionReason ?? "", /narrower comparison/);
  const refined = await runner.act(stored.id, {
    action: "refine",
    direction: "Prioritize primary sources published since 2024",
  });
  assert.equal(refined.direction, "Prioritize primary sources published since 2024");
  assert.equal(refined.iterations.length, 2);
});

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

test("actions reconcile a completed Flow before lifecycle validation", async () => {
  let stored = checkpointMission({
    status: "running",
    iterations: [{
      ...checkpointMission().iterations[0],
      status: "running",
      finishedAt: undefined,
    }],
  });
  const killed: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    loadFlowRun: async () => ({ ...RUN, status: "succeeded", finishedAt: NOW.toISOString() }),
    loadConversation: async () => ({
      sessionId: "session-1",
      familiarId: "sage",
      harness: "codex",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      turns: [{
        id: "turn-1",
        role: "assistant",
        text: [
          "@@research-control",
          '{"decision":"complete","reason":"Already complete","confidence":0.9}',
          "@@research-artifacts-written",
        ].join("\n"),
        createdAt: NOW.toISOString(),
      }],
    }),
    readMissionFile: async () => "# Complete\n",
    killSession: async (id) => { killed.push(id); },
  }));
  const result = await runner.act(stored.id, { action: "cancel" });
  assert.equal(result.status, "completed");
  assert.deepEqual(killed, []);
});

test("retry relaunches the failed iteration even when the mission limit is one", async () => {
  let stored = checkpointMission({
    mode: "brief",
    status: "failed",
    bounds: { ...checkpointMission().bounds, maxIterations: 1 },
    iterations: [{ number: 1, status: "failed", finishedAt: NOW.toISOString() }],
  });
  let starts = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async () => {
      starts += 1;
      return { ok: true, executor: "session", sessionId: "retry-session", run: RUN };
    },
  }));
  const result = await runner.act(stored.id, { action: "retry" });
  assert.equal(starts, 1);
  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].status, "running");
});

test("retry clears a rejected project root and reruns in the mission workspace", async () => {
  let stored = checkpointMission({
    mode: "brief",
    status: "failed",
    projectRoot: "/missing/repo",
    iterations: [{ number: 1, status: "failed", finishedAt: NOW.toISOString() }],
  });
  const roots: Array<string | null> = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    resolveProjectRoot: async (root) => root === "/missing/repo" ? null : root,
    startFlow: async (_flow, options) => {
      roots.push(options.projectRoot);
      return { ok: true, executor: "session", sessionId: "retry-session", run: RUN };
    },
  }));
  const result = await runner.act(stored.id, { action: "retry", projectRoot: null });
  assert.deepEqual(roots, ["/tmp/research-missions/mission-actions"]);
  assert.equal(result.projectRoot, undefined, "the invalid root must not survive the retry");
  assert.equal(result.status, "running");
});

test("retry validates a project root override before persisting it", async () => {
  let stored = checkpointMission({
    mode: "brief",
    status: "failed",
    iterations: [{ number: 1, status: "failed", finishedAt: NOW.toISOString() }],
  });
  const roots: Array<string | null> = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    resolveProjectRoot: async (root) => (
      root === "/repos/app" || root === "/real/repos/app" ? "/real/repos/app" : null
    ),
    startFlow: async (_flow, options) => {
      roots.push(options.projectRoot);
      return { ok: true, executor: "session", sessionId: "retry-session", run: RUN };
    },
  }));
  await assert.rejects(
    () => runner.act(stored.id, { action: "retry", projectRoot: "/not/allowed" }),
    /"\/not\/allowed" is not an allowed project path/,
  );
  assert.deepEqual(roots, [], "an invalid override must not launch anything");
  assert.equal(stored.status, "failed");

  const result = await runner.act(stored.id, { action: "retry", projectRoot: "/repos/app" });
  assert.deepEqual(roots, ["/real/repos/app"]);
  assert.equal(result.projectRoot, "/real/repos/app");
  assert.equal(result.status, "running");
});

test("completed automation runs validate evidence and publish Knowledge", async () => {
  const run: AutomationRunRecord = {
    id: "automation-run-complete",
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
      checkpointFingerprint: "before",
    },
  });
  const published: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => { stored = structuredClone(mission); },
    latestAutomationRun: async () => run,
    readAutomationTranscript: async () => [
      "@@research-control",
      '{"decision":"complete","reason":"Evidence complete","confidence":0.9}',
      "@@research-artifacts-written",
    ].join("\n"),
    fingerprintMission: async () => "after",
    readMissionFile: async (_id, relativePath) => relativePath === "artifacts/primary.md" ? "# Final evidence\n" : null,
    readSources: async () => [{
      id: "source-1",
      title: "Primary source",
      url: "https://example.com/source",
      sourceType: "web",
      status: "used",
    }],
    publishKnowledge: async (entry) => { published.push(entry.body); return entry; },
  }));
  const result = await runner.reconcileAutomation(stored);
  assert.equal(result.status, "completed");
  assert.equal(result.artifacts[0].state, "published");
  assert.equal(result.sources.length, 1);
  assert.equal(published.length, 1);
});

test("reconciliation and actions share one read-modify-write lock", async () => {
  const run: AutomationRunRecord = {
    id: "automation-run-lock",
    automationId: "automation-1",
    automationName: "Research mission",
    startedAt: NOW.toISOString(),
    status: "queued",
  };
  let stored = checkpointMission({
    automation: {
      id: "automation-1",
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      status: "ACTIVE",
      checkpointFingerprint: "before",
    },
  });
  let releaseRun!: () => void;
  const runGate = new Promise<void>((resolve) => { releaseRun = resolve; });
  let observedRun!: () => void;
  const runObserved = new Promise<void>((resolve) => { observedRun = resolve; });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    latestAutomationRun: async () => { observedRun(); await runGate; return run; },
  }));
  const reconciling = runner.reconcileAutomation(structuredClone(stored));
  await runObserved;
  const attaching = runner.act(stored.id, {
    action: "attach-source",
    source: { id: "manual", title: "Manual", url: "https://example.com/manual" },
  });
  releaseRun();
  await Promise.all([reconciling, attaching]);
  assert.equal(stored.sources.length, 1);
});

test("malformed sources checkpoint the mission instead of publishing", async () => {
  let stored = checkpointMission({ status: "running" });
  const runner = makeResearchMissionRunner(deps({
    saveMission: async (mission) => { stored = structuredClone(mission); },
    loadFlowRun: async () => ({ ...RUN, status: "succeeded", finishedAt: NOW.toISOString() }),
    loadConversation: async () => ({
      sessionId: "session-1",
      familiarId: "sage",
      harness: "codex",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      turns: [{
        id: "turn-1",
        role: "assistant",
        text: [
          "@@research-control",
          '{"decision":"complete","reason":"Done","confidence":0.9}',
          "@@research-artifacts-written",
        ].join("\n"),
        createdAt: NOW.toISOString(),
      }],
    }),
    readMissionFile: async () => "# Artifact\n",
    readSources: async () => { throw new Error("sources.json is malformed"); },
  }));
  const result = await runner.reconcile(stored);
  assert.equal(result.status, "checkpoint");
  assert.match(result.lastError ?? "", /sources\.json is malformed/);
});

test("cancel treats an already-gone session as stopped (cave-malz)", () => {
  // Verified against the live daemon: an already-exited session kills as 409;
  // unknown/pruned (and Cave-direct) sessions are 404/410; 0 = no daemon.
  assert.equal(sessionAlreadyGone({ ok: false, status: 404 }), true);
  assert.equal(sessionAlreadyGone({ ok: false, status: 409 }), true);
  assert.equal(sessionAlreadyGone({ ok: false, status: 410 }), true);
  assert.equal(sessionAlreadyGone({ ok: false, status: 0 }), true);
  // Auth/rate-limit rejections: the daemon or hub is alive and the session
  // may still be running — cancel stays blocked.
  assert.equal(sessionAlreadyGone({ ok: false, status: 401 }), false);
  assert.equal(sessionAlreadyGone({ ok: false, status: 403 }), false);
  assert.equal(sessionAlreadyGone({ ok: false, status: 429 }), false);
  // A live daemon actively erroring may still be running the session.
  assert.equal(sessionAlreadyGone({ ok: false, status: 500 }), false);
  assert.equal(sessionAlreadyGone({ ok: false, status: 502 }), false);
  // A successful kill was a genuinely running session, not a gone one.
  assert.equal(sessionAlreadyGone({ ok: true, status: 200 }), false);
});

// ── Dead/finished session detection during flow reconcile (cave-ibb7) ─────────
// The flow-run record only says a run STARTED; nothing flips it when the
// underlying agent session ends. Reconcile probes the session itself.

test("a finished session reconciles from its transcript while the flow run still says running", async () => {
  const published: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    loadFlowRun: async () => ({ ...RUN, status: "running" }),
    sessionState: async () => "finished",
    readSessionTranscript: async () => [
      "@@research-control",
      '{"decision":"complete","reason":"Enough evidence","confidence":0.9}',
      "@@research-artifacts-written",
    ].join("\n"),
    // The transcript override must not cost the mission its reported spend —
    // costUsd still comes from the persisted conversation turns.
    loadConversation: async () => ({
      sessionId: "session-1",
      familiarId: "sage",
      harness: "codex",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      turns: [{
        id: "turn-1",
        role: "assistant",
        text: "narrative without markers",
        costUsd: 1.25,
        createdAt: NOW.toISOString(),
      }],
    }),
    readMissionFile: async (_id, relativePath) =>
      relativePath === "artifacts/primary.md" ? "# Evidence-backed answer\n" : null,
    publishKnowledge: async (entry) => {
      published.push(entry.body);
      return entry;
    },
  }));
  const started = await runner.createAndStart(INPUT);
  const result = await runner.reconcile(started);
  assert.equal(result.status, "completed");
  assert.equal(result.iterations[0].status, "completed");
  assert.equal(result.iterations[0].costUsd, 1.25);
  assert.equal(published.length, 1);
});

test("a dead session fails the mission with Retry enabled instead of hanging", async () => {
  const runner = makeResearchMissionRunner(deps({
    loadFlowRun: async () => ({ ...RUN, status: "running" }),
    sessionState: async () => "gone",
    // Two minutes after start — safely past the startup grace window.
    now: () => new Date(NOW.getTime() + 120_000),
  }));
  const started = await runner.createAndStart(INPUT);
  const result = await runner.reconcile(started);
  assert.equal(result.status, "failed");
  assert.equal(result.iterations[0].status, "failed");
  assert.match(result.lastError ?? "", /Retry starts a fresh iteration/);
  assert.ok(allowedResearchActions(result).includes("retry"), "failed missions offer Retry");
});

test("a gone-looking session within startup grace stays running (registration races)", async () => {
  const runner = makeResearchMissionRunner(deps({
    loadFlowRun: async () => ({ ...RUN, status: "running" }),
    sessionState: async () => "gone",
    // deps.now() === iteration.startedAt — inside the grace window.
  }));
  const started = await runner.createAndStart(INPUT);
  const result = await runner.reconcile(started);
  assert.equal(result.status, "running");
});

test("an unknown session state (daemon unreachable) changes nothing", async () => {
  const runner = makeResearchMissionRunner(deps({
    loadFlowRun: async () => ({ ...RUN, status: "running" }),
    sessionState: async () => "unknown",
    now: () => new Date(NOW.getTime() + 120_000),
  }));
  const started = await runner.createAndStart(INPUT);
  const result = await runner.reconcile(started);
  assert.equal(result.status, "running");
});

test("withinStartupGrace bounds the dead-session verdict", () => {
  const now = new Date("2026-07-15T00:10:00Z");
  assert.equal(withinStartupGrace("2026-07-15T00:09:30Z", now), true);  // 30s old
  assert.equal(withinStartupGrace("2026-07-15T00:08:00Z", now), false); // 2m old
  // Clock skew gets grace, but far-future bad data can't suppress detection.
  assert.equal(withinStartupGrace("2026-07-15T00:10:30Z", now), true);  // 30s ahead
  assert.equal(withinStartupGrace("2026-07-15T00:20:00Z", now), false); // 10m ahead
  assert.equal(withinStartupGrace(undefined, now), false);
  assert.equal(withinStartupGrace("not-a-date", now), false);
});
