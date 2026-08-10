import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationFile } from "../cave-conversations.ts";
import type { FlowRunRecord } from "../flows.ts";
import { allowedResearchActions, type ResearchMission, type ResearchSourcePatch } from "../research-missions.ts";
import {
  CopilotArgvTransportError,
  CopilotPromptTransportError,
  copilotPromptTransportFailure,
} from "./flow-copilot-session.ts";
import { ResearchFileIntegrityError } from "./research-mission-store.ts";
import {
  cancelResearchSession,
  makeResearchMissionRunner,
  parseResearchSourcesFile,
  ResearchMissionLaunchInputError,
  type ResearchMissionRunnerDeps,
} from "./research-mission-runner.ts";

test("Research cancellation stops a Cave-direct run before considering the daemon", async () => {
  const calls: string[] = [];
  await cancelResearchSession("direct-session", {
    cancelDirect: async (sessionId) => {
      calls.push(`direct:${sessionId}`);
      return "terminated";
    },
    callDaemonImpl: async () => {
      calls.push("daemon");
      return { ok: false, status: 404 };
    },
  });
  assert.deepEqual(calls, ["direct:direct-session"]);
});

test("Research cancellation uses the daemon only when no direct owner exists", async () => {
  const calls: string[] = [];
  await cancelResearchSession("daemon/session", {
    cancelDirect: async () => "not-owned",
    callDaemonImpl: async (request) => {
      calls.push(`${request.method}:${request.path}`);
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(calls, ["POST:/api/v1/sessions/daemon%2Fsession/kill"]);
});

test("a direct cancellation failure never falls through to a misleading daemon kill", async () => {
  let daemonCalls = 0;
  await assert.rejects(
    cancelResearchSession("still-running-direct-session", {
      cancelDirect: async () => { throw new Error("process tree could not be proved stopped"); },
      callDaemonImpl: async () => {
        daemonCalls += 1;
        return { ok: true, status: 200 };
      },
    }),
    /process tree could not be proved stopped/,
  );
  assert.equal(daemonCalls, 0);
});

test("daemon transport uncertainty never masquerades as an already-stopped session", async () => {
  for (const response of [
    { ok: false, status: 0, error: "local daemon offline" },
    { ok: false, status: 0, error: "hub request timed out" },
    { ok: false, status: 408, error: "request timeout" },
  ]) {
    await assert.rejects(
      cancelResearchSession("possibly-live-session", {
        cancelDirect: async () => "not-owned",
        callDaemonImpl: async () => response,
      }),
      /could not be confirmed.*mission remains running.*retry Cancel/i,
    );
  }
});

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
    ensureResearchAccess: async () => {},
    checkFamiliarRootAccess: async () => null,
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

test("every Research start path stops a launched session when the final mission save fails", async () => {
  const cases = [
    {
      name: "create",
      initial: null,
      run: (runner: ReturnType<typeof makeResearchMissionRunner>) => runner.createAndStart(INPUT),
    },
    {
      name: "retry",
      initial: checkpointMission({
        status: "failed",
        lastError: "previous failure",
        iterations: [{ number: 1, status: "failed", finishedAt: NOW.toISOString() }],
      }),
      run: (runner: ReturnType<typeof makeResearchMissionRunner>) => (
        runner.act("mission-actions", { action: "retry" })
      ),
    },
    {
      name: "continue",
      initial: checkpointMission(),
      run: (runner: ReturnType<typeof makeResearchMissionRunner>) => (
        runner.act("mission-actions", { action: "continue" })
      ),
    },
  ];

  for (const scenario of cases) {
    let stored = scenario.initial ? structuredClone(scenario.initial) : null;
    let saveCount = 0;
    const killed: string[] = [];
    const runner = makeResearchMissionRunner(deps({
      loadMission: async () => stored ? structuredClone(stored) : null,
      saveMission: async (mission) => {
        saveCount += 1;
        // Every path first saves its pre-launch planning record. Fail only the
        // first post-launch result write, then allow compensation to persist.
        if (saveCount === 2) throw new Error(`${scenario.name} result save failed`);
        stored = structuredClone(mission);
      },
      startFlow: async (_flow, options) => {
        assert.equal(options.offlinePolicy, "reject", "Research never enters the travel replay queue");
        return { ok: true, run: RUN, sessionId: `session-${scenario.name}`, executor: "session" };
      },
      killSession: async (sessionId) => { killed.push(sessionId); },
    }));

    const result = await scenario.run(runner);
    assert.deepEqual(killed, [`session-${scenario.name}`]);
    assert.equal(result.status, "failed", `${scenario.name} returns a durably retryable failure`);
    assert.match(result.lastError ?? "", /stopped because Cave could not save its launch state/);
    assert.equal(stored?.status, "failed");
    assert.equal(stored?.iterations.at(-1)?.sessionId, undefined, "a proved-stopped owner is not retained as live");
  }
});

test("a failed post-launch save retains the exact session when cleanup cannot be proved", async () => {
  let stored: ResearchMission | null = null;
  let saveCount = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => stored ? structuredClone(stored) : null,
    saveMission: async (mission) => {
      saveCount += 1;
      if (saveCount === 2) throw new Error("result save failed");
      stored = structuredClone(mission);
    },
    startFlow: async () => ({ ok: true, run: RUN, sessionId: "owned-session", executor: "session" }),
    killSession: async () => { throw new Error("termination not proved"); },
  }));

  const result = await runner.createAndStart(INPUT);
  assert.equal(result.status, "running", "unproved cleanup is never mislabeled failed or cancelled");
  assert.equal(result.iterations[0]?.sessionId, "owned-session");
  assert.match(result.lastError ?? "", /could not.*confirm session cleanup/i);
  assert.deepEqual(allowedResearchActions(result), ["cancel"]);
});

test("a failed save retries an owner whose launch cleanup was already unconfirmed", async () => {
  let stored: ResearchMission | null = null;
  let saveCount = 0;
  const killed: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => stored ? structuredClone(stored) : null,
    saveMission: async (mission) => {
      saveCount += 1;
      if (saveCount === 2) throw new Error("cleanup-unconfirmed result save failed");
      stored = structuredClone(mission);
    },
    startFlow: async () => ({
      ok: false,
      sessionId: "still-owned-session",
      cleanupUnconfirmed: true,
      error: "initial termination was not proved",
    }),
    killSession: async (sessionId) => { killed.push(sessionId); },
  }));

  const result = await runner.createAndStart(INPUT);
  assert.deepEqual(killed, ["still-owned-session"], "the only exact owner is retried before its id can be lost");
  assert.equal(result.status, "failed");
  assert.equal(result.iterations[0]?.sessionId, undefined);
  assert.equal((stored as ResearchMission | null)?.status, "failed");
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

test("typed Windows prompt refusal is persisted immediately across create, retry, and refine", async () => {
  const saved: ResearchMission[] = [];
  let starts = 0;
  const transportError = new CopilotPromptTransportError(30_001, 30_000);
  const transportFailure = copilotPromptTransportFailure(transportError);
  assert.ok(transportFailure, "the direct-Copilot seam maps only the typed transport refusal");
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => saved.length > 0 ? structuredClone(saved.at(-1)!) : null,
    saveMission: async (mission) => { saved.push(structuredClone(mission)); },
    startFlow: async () => {
      starts += 1;
      return transportFailure;
    },
  }));

  const typedMission = async (operation: Promise<ResearchMission>): Promise<ResearchMission> => {
    try {
      await operation;
      assert.fail("typed prompt refusal must reject through the HTTP-facing status contract");
    } catch (error) {
      assert.ok(error instanceof ResearchMissionLaunchInputError);
      assert.equal(error.status, 413);
      assert.equal(error.message, transportError.message);
      return error.mission;
    }
  };

  const created = await typedMission(runner.createAndStart(INPUT));
  assert.equal(created.status, "failed");
  assert.equal(created.iterations[0].status, "failed");
  assert.equal(created.lastError, transportError.message);
  assert.equal(saved.at(-1)?.status, "failed", "creation never leaves a planning orphan");
  assert.ok(allowedResearchActions(created).includes("retry"));

  const retried = await typedMission(runner.act(created.id, { action: "retry" }));
  assert.equal(retried.status, "failed");
  assert.equal(retried.iterations[0].status, "failed");
  assert.equal(retried.lastError, transportError.message);
  assert.equal(saved.at(-1)?.status, "failed", "retry records the same actionable refusal immediately");
  assert.equal(starts, 2);

  let refinedStored = checkpointMission();
  const refineRunner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(refinedStored),
    saveMission: async (mission) => { refinedStored = structuredClone(mission); },
    startFlow: async () => transportFailure,
  }));
  const refined = await typedMission(refineRunner.act(refinedStored.id, {
    action: "refine",
    direction: "Use a valid but transport-heavy evidence framing",
  }));
  assert.equal(refined.status, "failed");
  assert.equal(refined.iterations.length, 2);
  assert.equal(refined.iterations.at(-1)?.status, "failed");
  assert.equal(refined.lastError, transportError.message);
  assert.ok(allowedResearchActions(refined).includes("retry"));
});

test("malformed argv transport is persisted and remains a typed 400", async () => {
  const transportFailure = copilotPromptTransportFailure(
    new CopilotArgvTransportError("argument 4", "contains unpaired UTF-16 surrogate"),
  );
  assert.ok(transportFailure);
  let stored: ResearchMission | null = null;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => stored ? structuredClone(stored) : null,
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async () => transportFailure,
  }));

  await assert.rejects(
    runner.createAndStart(INPUT),
    (error: unknown) => {
      assert.ok(error instanceof ResearchMissionLaunchInputError);
      assert.equal(error.status, 400);
      assert.equal(error.mission.status, "failed");
      assert.equal(stored?.status, "failed", "typed response does not trade away durable retry state");
      return true;
    },
  );
});

test("create and refine reject invalid prompt data before any launch or lossy persistence", async () => {
  let starts = 0;
  let saves = 0;
  const runner = makeResearchMissionRunner(deps({
    saveMission: async () => { saves += 1; },
    startFlow: async () => {
      starts += 1;
      return { ok: true, run: RUN, sessionId: "must-not-start" };
    },
  }));
  await assert.rejects(
    runner.createAndStart({ ...INPUT, intent: "invalid\0hidden" }),
    /invalid NUL character/,
  );
  assert.deepEqual({ starts, saves }, { starts: 0, saves: 0 });

  let stored = checkpointMission();
  const refineRunner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async () => {
      starts += 1;
      return { ok: true, run: RUN, sessionId: "must-not-refine" };
    },
  }));
  await assert.rejects(
    refineRunner.act(stored.id, { action: "refine", direction: `x${"y".repeat(2_000)}` }),
    /at most 2000 characters/,
  );
  await assert.rejects(
    refineRunner.act(stored.id, { action: "refine", direction: "valid prefix\0hidden" }),
    /invalid refined direction/,
  );
  assert.equal(starts, 0);
  assert.equal(stored.status, "checkpoint");
  assert.equal(stored.direction, undefined);
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

test("a distinct canonical mission workspace remains the narrow write grant", async () => {
  const grants: Array<string[] | undefined> = [];
  const roots: Array<string | null> = [];
  const runner = makeResearchMissionRunner(deps({
    startFlow: async (_flow, options) => {
      grants.push(options.addDirs);
      roots.push(options.projectRoot);
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));
  await runner.createAndStart({ ...INPUT, projectRoot: "/allowed/repo" });
  assert.deepEqual(roots, ["/allowed/repo"]);
  assert.deepEqual(grants, [["/tmp/research-missions/mission-1"]]);
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

test("run start ensures the familiar's standard research landing access", async () => {
  const ensured: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    ensureResearchAccess: async (familiarId) => {
      ensured.push(familiarId);
    },
  }));
  const result = await runner.createAndStart(INPUT);
  assert.deepEqual(ensured, ["sage"]);
  assert.equal(result.status, "running");
});

test("a configured project root the familiar cannot access fails fast before launch", async () => {
  let starts = 0;
  const checked: Array<[string, string]> = [];
  const runner = makeResearchMissionRunner(deps({
    checkFamiliarRootAccess: async (familiarId, projectRoot) => {
      checked.push([familiarId, projectRoot]);
      return `Familiar "${familiarId}" does not have access to project root "${projectRoot}".`;
    },
    startFlow: async () => {
      starts += 1;
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));
  const result = await runner.createAndStart({ ...INPUT, projectRoot: "/allowed/repo" });
  assert.equal(starts, 0, "no session may launch against a root the familiar cannot use");
  assert.deepEqual(checked, [["sage", "/allowed/repo"]]);
  assert.equal(result.status, "failed");
  assert.match(result.lastError ?? "", /does not have access to project root "\/allowed\/repo"/);
  assert.ok(allowedResearchActions(result).includes("retry"));
});

test("the default mission workspace never requires a familiar root-access check", async () => {
  let checks = 0;
  const runner = makeResearchMissionRunner(deps({
    checkFamiliarRootAccess: async () => {
      checks += 1;
      return "should never be consulted";
    },
  }));
  const result = await runner.createAndStart(INPUT);
  assert.equal(checks, 0);
  assert.equal(result.status, "running");
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

test("a finished run without its primary artifact fails instead of masquerading as a checkpoint", async () => {
  const runner = makeResearchMissionRunner(deps({
    loadFlowRun: async () => ({ ...RUN, status: "succeeded", finishedAt: NOW.toISOString() }),
    // This reproduces a direct session that was reported finished but never
    // persisted its transcript or wrote the mission workspace.
    loadConversation: async () => null,
    readMissionFile: async () => null,
  }));
  const started = await runner.createAndStart(INPUT);
  const result = await runner.reconcile(started);

  assert.equal(result.status, "failed");
  assert.equal(result.iterations[0].status, "failed");
  assert.equal(result.iterations[0].decision, undefined);
  assert.match(result.lastError ?? "", /artifacts\/primary\.md/);
  assert.ok(allowedResearchActions(result).includes("retry"));
  assert.ok(!allowedResearchActions(result).includes("continue"));
});

test("a reviewable primary artifact still creates a checkpoint", async () => {
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
        '{"decision":"checkpoint","reason":"Review the evidence","confidence":0.7}',
        "@@research-artifacts-written",
      ].join("\n"),
      createdAt: NOW.toISOString(),
    }],
  } satisfies ConversationFile;
  const runner = makeResearchMissionRunner(deps({
    loadFlowRun: async () => ({ ...RUN, status: "succeeded", finishedAt: NOW.toISOString() }),
    loadConversation: async () => conversation,
    readMissionFile: async (_id, relativePath) => (
      relativePath === "artifacts/primary.md" ? "# Evidence-backed draft\n" : null
    ),
  }));
  const started = await runner.createAndStart(INPUT);
  const result = await runner.reconcile(started);

  assert.equal(result.status, "checkpoint");
  assert.equal(result.iterations[0].status, "checkpoint");
  assert.equal(result.lastError, undefined);
  assert.ok(allowedResearchActions(result).includes("continue"));
});

test("successful evidence reconciliation publishes every provenance-rich artifact", async () => {
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
    // createAndStart provisions the real four-ref set (primary, findings,
    // source-ledger, research-log — cave research-final-artifacts Task 3),
    // so every standard file must resolve, not just the primary.
    readMissionFile: async (_id, relativePath) => (
      relativePath === "artifacts/primary.md" ? "# Evidence-backed answer\n" :
      relativePath === "findings.md" ? "# Findings\n" :
      relativePath === "research-log.md" ? "# Research log\n" :
      null
    ),
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
  assert.equal(result.lastError, undefined);
  assert.equal(result.artifacts.length, 4);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.state, "published", `${artifact.key} must publish`);
  }
  assert.equal(result.sources.length, 1);
  assert.equal(published.length, 4);
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

test("cancel does not mark the mission cancelled until process termination is acknowledged", async () => {
  let stored = checkpointMission({
    status: "running",
    iterations: [{
      ...checkpointMission().iterations[0],
      status: "running",
      finishedAt: undefined,
    }],
  });
  let releaseKill!: () => void;
  const killGate = new Promise<void>((resolve) => { releaseKill = resolve; });
  let killStarted!: () => void;
  const observedKill = new Promise<void>((resolve) => { killStarted = resolve; });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    killSession: async () => {
      killStarted();
      await killGate;
    },
  }));

  const cancelling = runner.act(stored.id, { action: "cancel" });
  await observedKill;
  assert.equal(stored.status, "running", "mission state stays live while its child tree may still run");
  releaseKill();
  const result = await cancelling;
  assert.equal(result.status, "cancelled");
});

test("a failed process-tree termination leaves the mission and iteration running", async () => {
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
    killSession: async () => { throw new Error("process tree remains live"); },
  }));

  await assert.rejects(
    runner.act(stored.id, { action: "cancel" }),
    /process tree remains live/,
  );
  assert.equal(stored.status, "running");
  assert.equal(stored.iterations[0].status, "running");
  assert.equal(stored.finishedAt, undefined);
});

test("daemon offline and hub timeout cancellation preserve durable running state", async () => {
  for (const message of [
    "Research session cancellation could not be confirmed because the daemon or hub was unreachable.",
    "Research session cancellation could not be confirmed because the daemon or hub returned HTTP 408.",
  ]) {
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
      killSession: async () => { throw new Error(`${message} The mission remains running; retry Cancel.`); },
    }));
    await assert.rejects(runner.act(stored.id, { action: "cancel" }), /mission remains running; retry Cancel/i);
    assert.equal(stored.status, "running");
    assert.equal(stored.iterations[0].status, "running");
    assert.equal(stored.finishedAt, undefined);
  }
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

test("continue recovers a rejected standard ref to working, leaving primary lineage resurrection untouched", async () => {
  // cave research-final-artifacts Fix 2: every later pass rewrites
  // findings.md/sources.json/research-log.md from scratch, so a rejected
  // standard ref should not stay a permanent dead end — the next iteration's
  // startNextIteration must recover it to "working" in place. This must
  // stay independent of the pre-existing primary-lineage resurrection (a new
  // `primary-i${n}` ref prepended, the old rejected primary ref preserved).
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "rejected", rejectionReason: "too shallow", updatedAt: NOW.toISOString() },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "source-ledger", kind: "source-ledger", title: "Source ledger", relativePath: "sources.json", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "research-log", kind: "research-log", title: "Research log", relativePath: "research-log.md", iteration: 1, state: "published", knowledgeId: "research-mission-actions-research-log", updatedAt: NOW.toISOString() },
    ],
  });
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

  // Reject the standard ref through the real action, exactly like an
  // operator would from the ledger.
  const rejected = await runner.act(stored.id, {
    action: "reject-artifact",
    artifactKey: "findings",
    reason: "needs more sources",
  });
  const rejectedFindings = rejected.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(rejectedFindings?.state, "rejected");
  assert.match(rejectedFindings?.rejectionReason ?? "", /needs more sources/);

  // Pinned refusal (~622–633): still true before any continue happens.
  await assert.rejects(
    () => runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" }),
    new Error("rejected artifacts need a new working version before publishing"),
  );

  const continued = await runner.act(stored.id, { action: "continue" });

  const findings = continued.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(findings?.state, "working", "the next pass regenerates findings.md, so a fresh working version exists");
  assert.equal(findings?.rejectionReason, undefined, "rejection metadata is cleared");

  // Refs that were never rejected are untouched by the recovery.
  assert.equal(continued.artifacts.find((artifact) => artifact.key === "source-ledger")?.state, "working");
  const researchLog = continued.artifacts.find((artifact) => artifact.key === "research-log");
  assert.equal(researchLog?.state, "published");
  assert.equal(researchLog?.knowledgeId, "research-mission-actions-research-log");

  // Primary lineage resurrection is unchanged by this fix: a fresh working
  // ref is prepended under a new per-iteration key, and the rejected
  // original survives at its own key (lineage history, not recovered in place).
  assert.equal(continued.artifacts[0].key, "primary-i2");
  assert.equal(continued.artifacts[0].state, "working");
  const oldPrimary = continued.artifacts.find((artifact) => artifact.key === "primary");
  assert.equal(oldPrimary?.state, "rejected");
  assert.equal(oldPrimary?.rejectionReason, "too shallow");
});

test("cancel kills a queued session that already carries a session id", async () => {
  // Travel handoffs and slow starts can leave a live session on an iteration
  // that still reads "queued" — cancel must kill it, not only "running" ones.
  const killed: string[] = [];
  let stored = checkpointMission({
    status: "queued",
    iterations: [{
      number: 1,
      status: "queued",
      flowRunId: "run-1",
      sessionId: "session-1",
      startedAt: NOW.toISOString(),
    }],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    killSession: async (sessionId) => { killed.push(sessionId); },
  }));
  const result = await runner.act(stored.id, { action: "cancel" });
  assert.deepEqual(killed, ["session-1"], "a queued iteration with a session keeps burning spend");
  assert.equal(result.status, "cancelled");
  assert.equal(result.iterations[0].status, "cancelled");
});

test("cancel keeps a settled iteration's recorded outcome", async () => {
  const killed: string[] = [];
  let stored = checkpointMission();
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    killSession: async (sessionId) => { killed.push(sessionId); },
  }));
  const result = await runner.act(stored.id, { action: "cancel" });
  assert.deepEqual(killed, [], "a settled iteration's session is already gone");
  assert.equal(result.status, "cancelled");
  assert.equal(result.iterations[0].status, "checkpoint", "the settled outcome must survive cancel");
  assert.equal(result.iterations[0].finishedAt, NOW.toISOString());
});

test("update-source rejects unknown fields, url/id tampering, and invalid values", async () => {
  let stored = checkpointMission({
    sources: [{
      id: "manual-1",
      title: "Spec",
      url: "https://example.com/spec",
      sourceType: "web",
      status: "candidate",
    }],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
  }));
  const rejections: Array<[Record<string, unknown>, RegExp]> = [
    [{ url: "javascript:alert(1)" }, /invalid source patch field: url/],
    [{ id: "hijacked" }, /invalid source patch field: id/],
    [{ addedAt: "2020-01-01T00:00:00.000Z" }, /invalid source patch field: addedAt/],
    [{ status: null }, /invalid source status/],
    [{ status: "definitely-not-a-status" }, /invalid source status/],
    [{ confidence: 7 }, /invalid source confidence/],
    [{ title: "   " }, /invalid source title/],
  ];
  for (const [patch, expected] of rejections) {
    await assert.rejects(
      runner.act(stored.id, {
        action: "update-source",
        sourceId: "manual-1",
        patch: patch as unknown as ResearchSourcePatch,
      }),
      expected,
    );
  }
  assert.equal(stored.sources[0].url, "https://example.com/spec", "the stored url must be untouched");
  assert.equal(stored.sources[0].id, "manual-1");
  assert.equal(stored.sources[0].status, "candidate");
});

test("createAndStart cannot resurrect a mission cancelled during launch", async () => {
  let stored: ResearchMission | null = null;
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
  let observedStart!: () => void;
  const startObserved = new Promise<void>((resolve) => { observedStart = resolve; });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => (stored ? structuredClone(stored) : null),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async () => {
      observedStart();
      await startGate;
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));
  const creating = runner.createAndStart(INPUT);
  await startObserved;
  const cancelling = runner.act("mission-1", { action: "cancel" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseStart();
  const [, cancelled] = await Promise.all([creating, cancelling]);
  const finalStored = stored as ResearchMission | null;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    finalStored?.status,
    "cancelled",
    "the launch-result save must not overwrite a concurrent cancel",
  );
});

test("continue and refine are refused while the linked automation is ACTIVE", async () => {
  const activeAutomation = {
    id: "automation-1",
    rrule: "RRULE:FREQ=DAILY",
    status: "ACTIVE" as const,
    checkpointFingerprint: "fp",
  };
  let stored = checkpointMission({ automation: activeAutomation });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
  }));
  // Two agents writing one mission workspace: manual iterations are refused
  // until the schedule is paused (cave-7had).
  await assert.rejects(
    runner.act(stored.id, { action: "continue" }),
    /pause the linked automation before running manually/,
  );
  await assert.rejects(
    runner.act(stored.id, { action: "refine", direction: "dig deeper" }),
    /pause the linked automation before running manually/,
  );
  assert.equal(stored.iterations.length, 1, "no manual iteration may start under an ACTIVE schedule");

  stored = checkpointMission({
    automation: { ...activeAutomation, status: "PAUSED" as const },
  });
  const result = await runner.act(stored.id, { action: "continue" });
  assert.equal(result.iterations.length, 2, "a paused schedule releases the manual-run guard");
});

test("publish-artifact publishes one working ref on a settled mission", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    lastError: "Artifact publish failed — findings: vault write failed",
  });
  const published: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async (_id, relativePath) => `# Content of ${relativePath}\n`,
    publishKnowledge: async (entry) => { published.push(entry.id); return entry; },
  }));
  const result = await runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" });
  assert.deepEqual(published, ["research-mission-actions-findings"]);
  const findings = result.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(findings?.state, "published");
  assert.equal(findings?.knowledgeId, "research-mission-actions-findings");
  assert.equal(result.status, "checkpoint", "manual publish never changes mission status");
  assert.equal(
    result.lastError,
    undefined,
    "publishing the only ref named in the failure banner clears it — it must never keep naming a now-published artifact (cave-o780)",
  );
});

test("publish-artifact rebuilds the failure banner from the refs that are STILL failing (cave-o780)", async () => {
  // Two refs failed to publish; retrying one successfully must drop only its
  // segment and keep the other's original reason — never keep naming the ref
  // that just published, and never clear while a real failure remains.
  let stored = checkpointMission({
    artifacts: [
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "research-log", kind: "research-log", title: "Research log", relativePath: "research-log.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    lastError: "Artifact publish failed — findings: vault write failed; research-log: vault write failed",
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async (_id, relativePath) => `# Content of ${relativePath}\n`,
  }));
  const result = await runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" });
  assert.equal(
    result.lastError,
    "Artifact publish failed — research-log: vault write failed",
    "the just-published ref drops out; the still-failing ref keeps its reason",
  );
});

test("publish-artifact clears the publish-failure lastError once nothing is left unpublished", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString(), knowledgeId: "research-mission-actions-primary" },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    lastError: "Artifact publish failed — findings: vault write failed",
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async () => "# Findings\n",
  }));
  const result = await runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" });
  assert.equal(result.lastError, undefined);
});

test("publish-artifact preserves an unrelated lastError", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    lastError: "run exceeded wall clock budget",
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async () => "# Findings\n",
  }));
  const result = await runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" });
  assert.equal(result.lastError, "run exceeded wall clock budget");
});

test("publish-artifact rejects running missions, published refs, rejected refs, and unknown keys", async () => {
  const base = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "published", knowledgeId: "research-mission-actions-findings", updatedAt: NOW.toISOString() },
      { key: "research-log", kind: "research-log", title: "Research log", relativePath: "research-log.md", iteration: 1, state: "rejected", rejectionReason: "sparse", updatedAt: NOW.toISOString() },
    ],
  });
  const cases: Array<[object, string, string]> = [
    [{ status: "running" }, "primary", "research mission is not settled yet"],
    [{}, "findings", "research artifact already published"],
    [{}, "research-log", "rejected artifacts need a new working version before publishing"],
    [{}, "nope", "research artifact not found"],
  ];
  for (const [overrides, artifactKey, message] of cases) {
    let stored = { ...structuredClone(base), ...overrides };
    const runner = makeResearchMissionRunner(deps({
      loadMission: async () => structuredClone(stored),
      saveMission: async (mission) => { stored = structuredClone(mission); },
      readMissionFile: async () => "# Content\n",
    }));
    await assert.rejects(
      () => runner.act(stored.id, { action: "publish-artifact", artifactKey }),
      new Error(message),
      message,
    );
  }
});

test("publish-artifact surfaces a missing file as a clear validation error", async () => {
  let stored = checkpointMission({
    artifacts: [{ key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() }],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async () => null,
  }));
  await assert.rejects(
    () => runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" }),
    new Error("research artifact file missing"),
  );
});

test("finish publishes the mission's working refs like a complete decision", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "source-ledger", kind: "source-ledger", title: "Source ledger", relativePath: "sources.json", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    sources: [{ id: "s1", title: "SQLite docs", url: "https://sqlite.org", sourceType: "web", status: "used" }],
  });
  const published: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async (_id, relativePath) => `# Content of ${relativePath}\n`,
    publishKnowledge: async (entry) => { published.push(entry.id); return entry; },
  }));
  const result = await runner.act(stored.id, { action: "finish" });
  assert.equal(result.status, "completed");
  assert.deepEqual(published.sort(), [
    "research-mission-actions-primary",
    "research-mission-actions-source-ledger",
  ]);
  assert.equal(result.lastError, undefined);
  for (const artifact of result.artifacts) assert.equal(artifact.state, "published");
});

test("finish surfaces publish failures without blocking completion", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async (_id, relativePath) => `# Content of ${relativePath}\n`,
    publishKnowledge: async (entry) => {
      if (entry.id.endsWith("-findings")) throw new Error("vault write failed");
      return entry;
    },
  }));
  const result = await runner.act(stored.id, { action: "finish" });
  assert.equal(result.status, "completed", "publish failure never blocks finishing");
  assert.match(result.lastError ?? "", /findings: vault write failed/);
  const findings = result.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(findings?.state, "working");
  assert.equal(findings?.knowledgeId, undefined);
  const primary = result.artifacts.find((artifact) => artifact.key === "primary");
  assert.equal(primary?.state, "published");
});

test("finish makes a missing primary retryable instead of completing a partial artifact set", async () => {
  let stored = checkpointMission();
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async () => null,
  }));
  const result = await runner.act(stored.id, { action: "finish" });

  assert.equal(result.status, "failed");
  assert.equal(result.iterations.at(-1)?.status, "failed");
  assert.equal(result.iterations.at(-1)?.decision, undefined);
  assert.match(result.lastError ?? "", /artifacts\/primary\.md/);
  assert.ok(allowedResearchActions(result).includes("retry"));
  assert.ok(!allowedResearchActions(result).includes("continue"));
  for (const artifact of result.artifacts) assert.equal(artifact.state, "working");
});

test("finish makes an unreadable primary retryable instead of 500ing after pauseAutomation (cave-v73d)", async () => {
  // A symlinked/oversized/escaping primary makes the store throw. Because finish
  // has already run pauseAutomation, a raw throw would 500 the whole action and
  // leave automation paused while the mission never settles. The read remains
  // defensive: it settles to a retryable failure without publishing a partial
  // artifact set.
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async (_id, relativePath) => {
      if (relativePath === "artifacts/primary.md") {
        throw new ResearchFileIntegrityError("research files cannot be symlinks");
      }
      return `# Content of ${relativePath}\n`;
    },
  }));
  const result = await runner.act(stored.id, { action: "finish" });
  assert.equal(result.status, "failed", "finish settles despite the unreadable primary");
  assert.ok(allowedResearchActions(result).includes("retry"));
  const primary = result.artifacts.find((artifact) => artifact.key === "primary");
  assert.notEqual(primary?.state, "published", "the unreadable primary is not published");
  const findings = result.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(findings?.state, "working", "a partial artifact set is not published");
  assert.match(result.lastError ?? "", /symlinks/, "the integrity failure is retained");
});

test("reject-artifact clears the stale publish-failure banner for the rejected ref (cave-o780)", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    lastError: "Artifact publish failed — findings: vault write failed",
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
  }));
  const result = await runner.act(stored.id, { action: "reject-artifact", artifactKey: "findings", reason: "bad data" });
  const findings = result.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(findings?.state, "rejected");
  assert.equal(
    result.lastError,
    undefined,
    "rejecting the last publish-pending ref clears its stale failure banner",
  );
});
