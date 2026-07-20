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


