import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationFile } from "../cave-conversations.ts";
import type { FlowRunRecord } from "../flows.ts";
import {
  allowedResearchActions,
  RESEARCH_DIRECTION_MAX_LENGTH,
  type ResearchMission,
  type ResearchSourcePatch,
} from "../research-missions.ts";
import {
  CopilotArgvTransportError,
  CopilotPromptTransportError,
  copilotPromptTransportFailure,
} from "./flow-copilot-session.ts";
import {
  RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC,
  ResearchFileIntegrityError,
} from "./research-mission-store.ts";
import {
  cancelResearchSession,
  makeResearchMissionRunner,
  parseResearchSourcesFile,
  researchDaemonSessionState,
  RESEARCH_ACTIVE_SESSION_OWNER_CONFLICT,
  ResearchMissionLaunchInputError,
  RESEARCH_SESSION_OWNER_REPAIR_REQUIRED,
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

test("Research cancellation stays on its persisted owner-local daemon authority", async () => {
  const calls: string[] = [];
  const authority = { kind: "owner-local-daemon" as const, socketPath: "/tmp/coven-original.sock" };
  await cancelResearchSession("daemon/session", {
    cancelDirect: async () => { throw new Error("owner-local daemon must not probe direct ids"); },
    callDaemonImpl: async () => {
      calls.push("generic-config-target");
      return { ok: false, status: 404 };
    },
    callDaemonTargetImpl: async (target, request) => {
      calls.push(`${target.socketPath}:${request.path}`);
      return { ok: true, status: 200 };
    },
  }, authority, "owner-local-daemon");
  assert.deepEqual(calls, ["/tmp/coven-original.sock:/api/v1/sessions/daemon%2Fsession/kill"]);
});

test("Research liveness stays on its persisted owner-local daemon authority", async () => {
  const calls: string[] = [];
  const state = await researchDaemonSessionState(
    "session-1",
    { kind: "owner-local-daemon", socketPath: "\\\\.\\pipe\\coven-original" },
    {
      callDaemonImpl: async () => {
        calls.push("generic-config-target");
        return { ok: true, status: 200, data: [] };
      },
      callDaemonTargetImpl: async (target) => {
        calls.push(target.socketPath);
        return {
          ok: true,
          status: 200,
          data: [{ id: "session-1", status: "running", exit_code: null }],
        };
      },
    },
  );
  assert.equal(state, "running");
  assert.deepEqual(calls, ["\\\\.\\pipe\\coven-original"]);
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

// cave-10kr8. The ledger is written by an AGENT, and the iteration prompt tells
// it to read/write sources.json without pinning a top-level shape — so a model
// that wraps the list in `{ mission, updated, sources, … }` is following the
// instruction. Requiring a bare array cost a whole mission: research-00b591f3
// wrote exactly that envelope carrying 25 valid sources against a target of 12,
// and every one was discarded, because runResearchIteration catches the throw,
// checkpoints, and merges NOTHING. The run then reported zero sources while its
// findings sat on disk — unsourced claims, the one output a research run must
// not produce.
const REAL_SOURCE = {
  id: "S1",
  title: "Brief independent investigation",
  url: "https://metr.org/blog/example",
};

test("an agent-written envelope around the ledger is accepted (cave-10kr8)", () => {
  // The exact shape the live mission wrote — sibling keys and all.
  const envelope = JSON.stringify({
    mission: "research-00b591f3",
    updated: "2026-08-28T13:55:00.000Z",
    sources: [REAL_SOURCE, { ...REAL_SOURCE, id: "S2" }],
    iteration2_summary: "…",
  });
  const parsed = parseResearchSourcesFile(envelope);
  assert.equal(parsed.length, 2, "every source in the envelope survives");
  assert.deepEqual(parsed.map((s) => s.id), ["S1", "S2"]);

  // A bare array is still the canonical form and must keep working.
  assert.equal(parseResearchSourcesFile(JSON.stringify([REAL_SOURCE])).length, 1);
});

test("only the ENVELOPE is relaxed — a bad entry still refuses (cave-10kr8)", () => {
  // Per-entry strictness is the part worth keeping: silently dropping evidence
  // from a ledger would be worse than refusing to load it, because the caller
  // cannot tell a short ledger from a filtered one.
  assert.throws(
    () => parseResearchSourcesFile(JSON.stringify({ sources: [REAL_SOURCE, { id: "bad" }] })),
    /sources\.json source 2/,
    "a malformed entry inside an envelope is still named by index",
  );
  // An object with no `sources` array is not an envelope, and the message says
  // both shapes rather than only the array.
  assert.throws(
    () => parseResearchSourcesFile('{"sources":"nope"}'),
    /must contain an array, or an object with a `sources` array/,
  );
  assert.throws(() => parseResearchSourcesFile('{"other":[]}'), /must contain an array/);
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
  let sessionOwner: Awaited<ReturnType<ResearchMissionRunnerDeps["loadSessionOwner"]>> = null;
  return {
    createWorkspace: async (mission) => mission,
    removeWorkspace: async () => {},
    loadMission: async () => null,
    saveMission: async () => {},
    finalizeTerminalRun: async () => {},
    loadSessionOwner: async () => sessionOwner ? structuredClone(sessionOwner) : null,
    recordSessionOwner: async (owner) => { sessionOwner = structuredClone(owner); },
    clearSessionOwner: async () => { sessionOwner = null; },
    assertSessionOwnerPrivate: async () => {},
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
    materializeSavedLink: async () => {
      throw new Error("saved X Article not found");
    },
    // No mission in this suite has attached X sources; the dedicated
    // hydration coverage lives in research-mission-x-hydration.test.ts.
    hydrateXSources: async () => ({ files: [], unavailable: [], sources: [] }),
    dropXRuntime: async () => {},
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

test("archive persists the mission-level status it replaced", async () => {
  for (const status of ["paused", "completed", "failed"] as const) {
    let stored = checkpointMission({ status });
    const runner = makeResearchMissionRunner(deps({
      loadMission: async () => structuredClone(stored),
      saveMission: async (mission) => { stored = structuredClone(mission); },
    }));

    const archived = await runner.act(stored.id, { action: "archive" });
    assert.equal(archived.status, "archived");
    assert.equal(archived.archivedFrom, status);
    assert.equal(stored.archivedFrom, status);
  }
});

test("Continue from a terminal mission allocates a new canonical run generation", async () => {
  for (const status of ["completed", "cancelled"] as const) {
    let stored = checkpointMission({
      status,
      finishedAt: NOW.toISOString(),
      iterations: [{
        number: 1,
        status,
        finishedAt: NOW.toISOString(),
      }],
      artifacts: [{
        key: "primary",
        kind: "findings",
        title: "Published first run",
        relativePath: "artifacts/primary.md",
        iteration: 1,
        state: "published",
        updatedAt: NOW.toISOString(),
      }],
    });
    const runner = makeResearchMissionRunner(deps({
      loadMission: async () => structuredClone(stored),
      saveMission: async (mission) => { stored = structuredClone(mission); },
    }));

    const continued = await runner.act(stored.id, { action: "continue" });
    assert.equal(continued.status, "running");
    assert.equal(continued.runGeneration, 2);
    assert.equal(continued.iterations.length, 2);
    assert.equal(continued.artifacts[0]?.state, "published");
    assert.equal(stored.runGeneration, 2);
  }
});

test("Retry and Finish cannot reopen an observed failed canonical run", async () => {
  for (const action of ["retry", "finish"] as const) {
    let stored = checkpointMission({
      status: "failed",
      finishedAt: NOW.toISOString(),
      lastError: "Provider failed",
      iterations: [{
        number: 1,
        status: "failed",
        finishedAt: NOW.toISOString(),
      }],
    });
    const runner = makeResearchMissionRunner(deps({
      loadMission: async () => structuredClone(stored),
      saveMission: async (mission) => { stored = structuredClone(mission); },
      readMissionFile: async () => "# Final research",
    }));

    const restarted = await runner.act(stored.id, { action });
    assert.equal(restarted.runGeneration, 2);
    assert.equal(stored.runGeneration, 2);
  }
});

test("terminal Continue, Retry, Finish, and Archive finalize before saving later state", async () => {
  const cases = [
    { status: "completed" as const, action: "continue" as const },
    { status: "cancelled" as const, action: "continue" as const },
    { status: "failed" as const, action: "retry" as const },
    { status: "failed" as const, action: "finish" as const },
    { status: "completed" as const, action: "archive" as const },
  ];
  for (const { status, action } of cases) {
    const calls: string[] = [];
    let stored = checkpointMission({
      status,
      finishedAt: NOW.toISOString(),
      ...(status === "failed" ? { lastError: "Provider failed" } : {}),
      iterations: [{
        number: 1,
        status,
        finishedAt: NOW.toISOString(),
      }],
    });
    const runner = makeResearchMissionRunner(deps({
      loadMission: async () => structuredClone(stored),
      finalizeTerminalRun: async (mission) => {
        calls.push(`finalize:${mission.status}:${mission.finishedAt}`);
      },
      saveMission: async (mission) => {
        calls.push(`save:${mission.status}:${mission.runGeneration ?? 1}`);
        stored = structuredClone(mission);
      },
      readMissionFile: async () => "# Final research",
    }));

    await runner.act(stored.id, { action });
    assert.equal(
      calls[0],
      `finalize:${status}:${NOW.toISOString()}`,
      `${status}/${action} must finalize the outgoing generation before any save`,
    );
  }
});

test("failed terminal finalization prevents mission generation advancement", async () => {
  let saves = 0;
  const stored = checkpointMission({
    status: "completed",
    finishedAt: NOW.toISOString(),
    iterations: [{
      number: 1,
      status: "completed",
      finishedAt: NOW.toISOString(),
    }],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    finalizeTerminalRun: async () => {
      throw new Error("terminal ledger unavailable");
    },
    saveMission: async () => { saves += 1; },
  }));

  await assert.rejects(
    runner.act(stored.id, { action: "continue" }),
    /terminal ledger unavailable/,
  );
  assert.equal(saves, 0);
});

test("terminal artifact administration finalizes before changing mission updatedAt", async () => {
  const calls: string[] = [];
  let stored = checkpointMission({
    status: "completed",
    finishedAt: NOW.toISOString(),
    iterations: [{
      number: 1,
      status: "completed",
      finishedAt: NOW.toISOString(),
    }],
    artifacts: [{
      key: "primary",
      kind: "findings",
      title: "Final findings",
      relativePath: "artifacts/primary.md",
      iteration: 1,
      state: "working",
      updatedAt: NOW.toISOString(),
    }],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    finalizeTerminalRun: async (mission) => {
      calls.push(`finalize:${mission.updatedAt}`);
    },
    saveMission: async (mission) => {
      calls.push(`save:${mission.updatedAt}`);
      stored = structuredClone(mission);
    },
    readMissionFile: async () => "# Final findings",
  }));

  await runner.act(stored.id, {
    action: "publish-artifact",
    artifactKey: "primary",
  });
  assert.equal(calls[0], `finalize:${NOW.toISOString()}`);
  assert.match(calls[1] ?? "", /^save:/);
});

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

test("create/start materializes selected saved links before the first launch", async () => {
  const calls: string[] = [];
  const savedMissionSources: string[][] = [];
  const runner = makeResearchMissionRunner(deps({
    createWorkspace: async (mission) => {
      calls.push("create");
      return mission;
    },
    materializeSavedLink: async (_mission, savedLinkId) => {
      calls.push(`materialize:${savedLinkId}`);
      return {
        source: {
          id: `saved-${savedLinkId}`,
          title: `Saved ${savedLinkId}`,
          url: `https://example.com/${savedLinkId}`,
          sourceType: "web",
          status: "candidate",
        },
        rollback: async () => {},
      };
    },
    saveMission: async (mission) => {
      calls.push("save");
      savedMissionSources.push(mission.sources.map((source) => source.id));
    },
    startFlow: async () => {
      calls.push("start");
      assert.deepEqual(savedMissionSources.at(-1), ["saved-link-a", "saved-link-b"]);
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));

  const result = await runner.createAndStart({
    ...INPUT,
    savedLinkIds: ["link-a", "link-b"],
  });

  assert.deepEqual(calls, [
    "create",
    "materialize:link-a",
    "materialize:link-b",
    "save",
    "start",
    "save",
  ]);
  assert.deepEqual(result.sources.map((source) => source.id), [
    "saved-link-a",
    "saved-link-b",
  ]);
});

test("create/start rolls back initial resource files when pre-launch persistence fails", async () => {
  const rollbackCalls: string[] = [];
  let startCalls = 0;
  const runner = makeResearchMissionRunner(deps({
    removeWorkspace: async (id) => {
      rollbackCalls.push(`workspace:${id}`);
    },
    materializeSavedLink: async () => ({
      source: {
        id: "saved-link-a",
        title: "Saved link",
        url: "https://example.com/link-a",
        sourceType: "web",
        status: "candidate",
      },
      rollback: async () => {
          rollbackCalls.push("resource");
      },
    }),
    saveMission: async () => {
      throw new Error("disk full");
    },
    startFlow: async () => {
      startCalls += 1;
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));

  await assert.rejects(
    runner.createAndStart({ ...INPUT, savedLinkIds: ["link-a"] }),
    /disk full/,
  );
  assert.deepEqual(rollbackCalls, ["resource", "workspace:mission-1"]);
  assert.equal(startCalls, 0);
});

test("create/start removes the new workspace when initial resource materialization fails", async () => {
  const calls: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    removeWorkspace: async (id) => {
      calls.push(`remove:${id}`);
    },
    materializeSavedLink: async () => {
      calls.push("materialize");
      throw new Error("saved link unavailable");
    },
  }));

  await assert.rejects(
    runner.createAndStart({ ...INPUT, savedLinkIds: ["link-a"] }),
    /saved link unavailable/,
  );
  assert.deepEqual(calls, ["materialize", "remove:mission-1"]);
});

test("create/start records exact daemon authority outside public mission state", async () => {
  const sessionAuthority = {
    kind: "owner-local-daemon" as const,
    socketPath: "/tmp/coven-start.sock",
  };
  const owners: unknown[] = [];
  const runner = makeResearchMissionRunner(deps({
    recordSessionOwner: async (owner) => {
      if (owners.length === 0) owners.push(structuredClone(owner));
      else assert.deepEqual(owner, owners[0], "post-return publication is an exact idempotent retry");
    },
    startFlow: async (_flow, options) => {
      await options.publishSessionOwner?.(
        "session-1",
        "owner-local-daemon",
        sessionAuthority,
      );
      assert.equal(owners.length, 1, "authority is durable before startFlow returns");
      return {
        ok: true,
        run: RUN,
        sessionId: "session-1",
        sessionAuthority,
        sessionOwnerKind: "owner-local-daemon",
        executor: "session",
      };
    },
  }));
  const result = await runner.createAndStart(INPUT);
  assert.equal("sessionAuthority" in (result.iterations[0] ?? {}), false);
  assert.deepEqual(owners, [{
    missionId: "mission-1",
    iteration: 1,
    sessionId: "session-1",
    ownerKind: "owner-local-daemon",
    authority: sessionAuthority,
    recordedAt: NOW.toISOString(),
  }]);
});

test("direct Copilot ownership is private and durable before startFlow returns", async () => {
  let recorded: unknown = null;
  const runner = makeResearchMissionRunner(deps({
    recordSessionOwner: async (owner) => {
      if (recorded === null) recorded = structuredClone(owner);
      else assert.deepEqual(owner, recorded);
    },
    startFlow: async (_flow, options) => {
      await options.publishSessionOwner?.("direct-session", "direct-copilot");
      assert.ok(recorded);
      return {
        ok: true,
        run: { ...RUN, sessionId: "direct-session" },
        sessionId: "direct-session",
        sessionOwnerKind: "direct-copilot",
        executor: "session",
      };
    },
  }));

  const result = await runner.createAndStart(INPUT);
  assert.deepEqual(recorded, {
    missionId: "mission-1",
    iteration: 1,
    sessionId: "direct-session",
    ownerKind: "direct-copilot",
    recordedAt: NOW.toISOString(),
  });
  assert.equal("sessionOwnerKind" in (result.iterations[0] ?? {}), false);
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

test("post-launch save compensation uses the exact cleanup owner returned by startFlow", async () => {
  let stored: ResearchMission | null = null;
  let saveCount = 0;
  let exactCleanupCalls = 0;
  let fallbackCleanupCalls = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => stored ? structuredClone(stored) : null,
    saveMission: async (mission) => {
      saveCount += 1;
      if (saveCount === 2) throw new Error("result save failed after authority-pinned launch");
      stored = structuredClone(mission);
    },
    startFlow: async () => ({
      ok: true,
      run: RUN,
      sessionId: "pinned-owner-session",
      executor: "session",
      cleanupSession: async () => { exactCleanupCalls += 1; },
    }),
    killSession: async () => { fallbackCleanupCalls += 1; },
  }));

  const result = await runner.createAndStart(INPUT);
  assert.equal(exactCleanupCalls, 1);
  assert.equal(fallbackCleanupCalls, 0, "config-aware fallback cannot replace the launch authority");
  assert.equal(result.status, "failed");
  assert.equal((stored as ResearchMission | null)?.status, "failed");
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
    refineRunner.act(stored.id, { action: "refine", direction: "x".repeat(RESEARCH_DIRECTION_MAX_LENGTH + 1) }),
    new RegExp(`at most ${RESEARCH_DIRECTION_MAX_LENGTH} characters`),
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

test("a project write grant containing the private owner ledger fails before spawn", async () => {
  let starts = 0;
  const checkedRoots: string[][] = [];
  const runner = makeResearchMissionRunner(deps({
    assertSessionOwnerPrivate: async (roots) => {
      checkedRoots.push(roots);
      throw new Error(RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC);
    },
    startFlow: async () => {
      starts += 1;
      return { ok: true, run: RUN, sessionId: "must-not-start", executor: "session" };
    },
  }));

  const result = await runner.createAndStart({
    ...INPUT,
    projectRoot: "/home/user/.coven",
  });

  assert.equal(starts, 0);
  assert.deepEqual(checkedRoots, [[
    "/home/user/.coven",
    "/tmp/research-missions/mission-1",
  ]]);
  assert.equal(result.status, "failed");
  assert.equal(result.lastError, RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC);
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

test("Continue advances from the latest persisted iteration number", async () => {
  let stored = checkpointMission({
    bounds: {
      ...checkpointMission().bounds,
      maxIterations: 5,
    },
    iterations: [
      { number: 1, status: "completed" },
      { number: 3, status: "checkpoint" },
    ],
  });
  let startedFlowId = "";
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async (flow) => {
      startedFlowId = flow.id;
      return {
        ok: true,
        executor: "session",
        sessionId: "session-4",
        run: { ...RUN, id: "run-4", flowId: flow.id, sessionId: "session-4" },
      };
    },
  }));

  const result = await runner.act(stored.id, { action: "continue" });

  assert.equal(result.iterations.at(-1)?.number, 4);
  assert.match(startedFlowId, /iteration-4$/);
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

test("one-pass cost approval starts the next iteration without weakening the policy", async () => {
  let stored = checkpointMission({
    bounds: {
      ...checkpointMission().bounds,
      stopWhenCostUnavailable: true,
    },
  });
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
  const result = await runner.act(stored.id, {
    action: "continue",
    approveCostUnavailable: true,
  });
  assert.equal(result.status, "running");
  assert.equal(result.iterations.length, 2);
  assert.equal(result.bounds.stopWhenCostUnavailable, true);
  assert.equal(starts, 1);
});

test("one-pass cost approval cannot override the reported spend cap", async () => {
  let stored = checkpointMission({
    bounds: {
      ...checkpointMission().bounds,
      maxSpendUsd: 1,
      stopWhenCostUnavailable: true,
    },
    iterations: [
      {
        ...checkpointMission().iterations[0],
        costUsd: 1,
      },
      {
        number: 2,
        status: "checkpoint",
        startedAt: NOW.toISOString(),
        finishedAt: NOW.toISOString(),
        decision: "checkpoint",
        decisionReason: "Review before continuing",
      },
    ],
  });
  let starts = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async () => {
      starts += 1;
      return { ok: true, executor: "session", sessionId: "must-not-start" };
    },
  }));
  const result = await runner.act(stored.id, {
    action: "continue",
    approveCostUnavailable: true,
  });
  assert.equal(result.status, "paused");
  assert.match(result.lastError ?? "", /Reported spend limit reached/);
  assert.equal(starts, 0);
});

test("a blocked Continue cannot downgrade a completed mission", async () => {
  const finishedAt = NOW.toISOString();
  let stored = checkpointMission({
    status: "completed",
    finishedAt,
    bounds: {
      ...checkpointMission().bounds,
      stopWhenCostUnavailable: true,
    },
    iterations: [{
      ...checkpointMission().iterations[0],
      status: "completed",
      decision: "complete",
      decisionReason: "Enough evidence",
    }],
  });
  let saves = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => {
      saves += 1;
      stored = structuredClone(mission);
    },
  }));
  const result = await runner.act(stored.id, { action: "continue" });
  assert.equal(result.status, "completed");
  assert.equal(result.finishedAt, finishedAt);
  assert.equal(result.lastError, undefined);
  assert.equal(saves, 0);
});

test("Resume approves one unmetered pass for a legacy cost-paused mission", async () => {
  let stored = checkpointMission({
    status: "paused",
    lastError: "Cost unavailable; review before another iteration",
    bounds: {
      ...checkpointMission().bounds,
      stopWhenCostUnavailable: true,
    },
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    startFlow: async (flow) => ({
      ok: true,
      executor: "session",
      sessionId: "session-2",
      run: { ...RUN, id: "run-2", flowId: flow.id, sessionId: "session-2" },
    }),
  }));
  const result = await runner.act(stored.id, {
    action: "resume",
    approveCostUnavailable: true,
  });
  assert.equal(result.status, "running");
  assert.equal(result.iterations.length, 2);
  assert.equal(result.lastError, undefined);
});

test("cancel kills the active session and preserves artifacts", async () => {
  const killed: Array<[string, unknown, unknown]> = [];
  let cleared = 0;
  const sessionAuthority = {
    kind: "owner-local-daemon" as const,
    socketPath: "/tmp/coven-cancel.sock",
  };
  let stored = checkpointMission({
    status: "running",
    iterations: [{
      ...checkpointMission().iterations[0],
      status: "running",
      finishedAt: undefined,
      sessionId: "attacker-replaced-session",
    }],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    loadSessionOwner: async () => ({
      missionId: stored.id,
      iteration: 1,
      sessionId: "session-1",
      ownerKind: "owner-local-daemon",
      authority: sessionAuthority,
      recordedAt: NOW.toISOString(),
    }),
    clearSessionOwner: async () => { cleared += 1; },
    killSession: async (sessionId, authority, ownerKind) => {
      killed.push([sessionId, authority, ownerKind]);
    },
  }));
  const result = await runner.act(stored.id, { action: "cancel" });
  assert.deepEqual(killed, [["session-1", sessionAuthority, "owner-local-daemon"]]);
  assert.equal(cleared, 1);
  assert.equal(result.status, "cancelled");
  assert.equal(result.artifacts.length, 1);
});

test("private direct ownership defeats mission session-id and terminal-state tampering", async () => {
  let stored = checkpointMission({
    status: "cancelled",
    finishedAt: NOW.toISOString(),
    iterations: [{
      number: 1,
      status: "cancelled",
      sessionId: "attacker-selected-session",
      finishedAt: NOW.toISOString(),
    }],
  });
  const owner = {
    missionId: stored.id,
    iteration: 1,
    sessionId: "real-direct-session",
    ownerKind: "direct-copilot" as const,
    recordedAt: NOW.toISOString(),
  };
  const killed: Array<[string, unknown, unknown]> = [];
  const order: string[] = [];
  let cleared = false;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => {
      order.push("save-cancelled");
      stored = structuredClone(mission);
    },
    loadSessionOwner: async () => structuredClone(owner),
    sessionState: async () => "unknown",
    killSession: async (sessionId, authority, ownerKind) => {
      order.push("kill");
      killed.push([sessionId, authority, ownerKind]);
    },
    clearSessionOwner: async (clearedOwner) => {
      order.push("clear-owner");
      assert.deepEqual(clearedOwner, owner);
      cleared = true;
    },
  }));

  const result = await runner.act(stored.id, { action: "cancel" });
  assert.deepEqual(killed, [["real-direct-session", undefined, "direct-copilot"]]);
  assert.deepEqual(order, ["kill", "save-cancelled", "clear-owner"]);
  assert.equal(cleared, true);
  assert.equal(result.status, "cancelled");
});

test("cancel retains private ownership when terminal mission persistence fails", async () => {
  const stored = checkpointMission({
    status: "running",
    iterations: [{ number: 1, status: "running", sessionId: "writable-session" }],
  });
  const owner = {
    missionId: stored.id,
    iteration: 1,
    sessionId: "private-session",
    ownerKind: "direct-copilot" as const,
    recordedAt: NOW.toISOString(),
  };
  let clearCalls = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    loadSessionOwner: async () => structuredClone(owner),
    sessionState: async () => "unknown",
    killSession: async () => {},
    saveMission: async () => { throw new Error("mission disk unavailable"); },
    clearSessionOwner: async () => { clearCalls += 1; },
  }));

  await assert.rejects(
    runner.act(stored.id, { action: "cancel" }),
    /mission disk unavailable/,
  );
  assert.equal(clearCalls, 0, "private owner remains retryable until cancelled state is durable");
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

test("missing or unreadable mission state cannot suppress exact-owner cancellation", async () => {
  const owner = {
    missionId: "mission-actions",
    iteration: 1,
    sessionId: "private-daemon-session",
    ownerKind: "owner-local-daemon" as const,
    authority: {
      kind: "owner-local-daemon" as const,
      socketPath: "/tmp/private-owner.sock",
    },
    recordedAt: NOW.toISOString(),
  };

  for (const loadMission of [
    async () => null,
    async (): Promise<ResearchMission | null> => { throw new Error("mission JSON malformed"); },
  ]) {
    const killed: unknown[] = [];
    let clears = 0;
    const runner = makeResearchMissionRunner(deps({
      loadMission,
      loadSessionOwner: async () => structuredClone(owner),
      killSession: async (...args) => { killed.push(args); },
      clearSessionOwner: async () => { clears += 1; },
    }));

    await assert.rejects(
      runner.act(owner.missionId, { action: "cancel" }),
      (error: unknown) => (
        error instanceof Error && error.message === RESEARCH_SESSION_OWNER_REPAIR_REQUIRED
      ),
    );
    assert.deepEqual(killed, [[owner.sessionId, owner.authority, owner.ownerKind]]);
    assert.equal(clears, 0, "repair-required cancellation must retain the private owner tombstone");
  }
});

test("an active private owner blocks lifecycle, artifact, and schedule mutations", async () => {
  const stored = checkpointMission({ mode: "autoresearch" });
  const owner = {
    missionId: stored.id,
    iteration: 1,
    sessionId: "private-direct-session",
    ownerKind: "direct-copilot" as const,
    recordedAt: NOW.toISOString(),
  };
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    loadSessionOwner: async () => structuredClone(owner),
    sessionState: async () => "running",
  }));

  for (const action of [
    { action: "attach-source" as const, source: { id: "manual", title: "Manual" } },
    { action: "attach-saved-link" as const, savedLinkId: "saved-link-1", familiarId: "sage" },
    { action: "update-source" as const, sourceId: "manual", patch: { note: "later" } },
    { action: "finish" as const },
    { action: "archive" as const },
    { action: "continue" as const },
    { action: "reject-artifact" as const, artifactKey: "primary", reason: "not yet" },
    { action: "publish-artifact" as const, artifactKey: "primary" },
  ]) {
    await assert.rejects(
      runner.act(stored.id, action),
      (error: unknown) => (
        error instanceof Error && error.message === RESEARCH_ACTIVE_SESSION_OWNER_CONFLICT
      ),
    );
  }
  await assert.rejects(
    runner.schedule(stored.id, { rrule: "RRULE:FREQ=DAILY" }),
    (error: unknown) => (
      error instanceof Error && error.message === RESEARCH_ACTIVE_SESSION_OWNER_CONFLICT
    ),
  );
});

test("manual sources normalize, preserve same-URL versions, and remain revisable", async () => {
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
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources.find((source) => source.id === "manual-1")?.status, "conflicting");
  assert.equal(
    result.sources.find((source) => source.id === "manual-1")?.note,
    "Different target cohort",
  );
  assert.equal(result.sources.find((source) => source.id === "manual-2")?.status, "used");
});

test("attach-saved-link materializes a matching familiar's Article and remains idempotent", async () => {
  let stored = checkpointMission();
  const materializedIds: string[] = [];
  let rollbacks = 0;
  const source = {
    id: "saved-0123456789abcdef01234567",
    title: "Durable research",
    url: "https://x.com/opencoven/status/123",
    localPath: "source-files/x-article-0123456789abcdef01234567.md",
    publisher: "OpenCoven",
    publishedAt: "2026-08-17T20:00:00.000Z",
    sourceType: "x-article",
    status: "candidate" as const,
  };
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    materializeSavedLink: async (_mission, savedLinkId) => {
      materializedIds.push(savedLinkId);
      return { source, rollback: async () => { rollbacks += 1; } };
    },
  }));

  const first = await runner.act(stored.id, {
    action: "attach-saved-link",
    savedLinkId: " saved-link-1 ",
    familiarId: "sage",
  });
  const repeated = await runner.act(stored.id, {
    action: "attach-saved-link",
    savedLinkId: "saved-link-1",
    familiarId: "sage",
  });

  assert.deepEqual(materializedIds, ["saved-link-1", "saved-link-1"]);
  assert.equal(first.sources.length, 1);
  assert.equal(repeated.sources.length, 1);
  assert.deepEqual(repeated.sources[0], source);
  assert.equal(rollbacks, 0);
});

test("reattaching a saved Article preserves reviewed fields and refreshes its materialized reference", async () => {
  let stored = checkpointMission();
  let materialization = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    materializeSavedLink: async () => {
      materialization += 1;
      return {
        source: materialization === 1
          ? {
            id: "saved-0123456789abcdef01234567",
            title: "Fetched article title",
            url: "https://x.com/opencoven/status/123",
            localPath: "source-files/x-article-original.md",
            publisher: "Fetched publisher",
            publishedAt: "2026-08-17T20:00:00.000Z",
            sourceType: "x-article",
            status: "candidate" as const,
          }
          : {
            id: "saved-0123456789abcdef01234567",
            title: "Refetched article title",
            url: "https://twitter.com/opencoven/status/123",
            localPath: "source-files/x-article-current.md",
            publisher: "Refetched publisher",
            publishedAt: "2026-08-18T20:00:00.000Z",
            sourceType: "x-article",
            status: "candidate" as const,
          },
        rollback: async () => {},
      };
    },
  }));

  await runner.act(stored.id, {
    action: "attach-saved-link",
    savedLinkId: "saved-link-1",
    familiarId: "sage",
  });
  await runner.act(stored.id, {
    action: "update-source",
    sourceId: "saved-0123456789abcdef01234567",
    patch: {
      title: "Reviewer title",
      publisher: "Reviewer publisher",
      publishedAt: "2020-01-01T00:00:00.000Z",
      sourceType: "primary source",
      claim: "Supports the primary claim",
      note: "Reviewed against the source",
      confidence: 0.9,
      status: "used",
    },
  });
  const repeated = await runner.act(stored.id, {
    action: "attach-saved-link",
    savedLinkId: "saved-link-1",
    familiarId: "sage",
  });

  assert.equal(repeated.sources.length, 1);
  assert.deepEqual(repeated.sources[0], {
    id: "saved-0123456789abcdef01234567",
    title: "Reviewer title",
    url: "https://twitter.com/opencoven/status/123",
    localPath: "source-files/x-article-current.md",
    publisher: "Reviewer publisher",
    publishedAt: "2020-01-01T00:00:00.000Z",
    sourceType: "primary source",
    claim: "Supports the primary claim",
    note: "Reviewed against the source",
    confidence: 0.9,
    status: "used",
  });
});

test("attach-saved-link rejects unauthorized inputs before reconciliation or any mutation", async () => {
  const stored = checkpointMission();
  let reconciliations = 0;
  let sessionOwnerLoads = 0;
  let materializations = 0;
  let saves = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    loadSessionOwner: async () => {
      sessionOwnerLoads += 1;
      return null;
    },
    loadFlowRun: async () => {
      reconciliations += 1;
      return null;
    },
    saveMission: async () => { saves += 1; },
    materializeSavedLink: async () => {
      materializations += 1;
      throw new Error("should not materialize");
    },
  }));

  await assert.rejects(
    () => runner.act(stored.id, {
      action: "attach-saved-link",
      savedLinkId: "saved-link-1",
      familiarId: "other",
    }),
    { message: "research mission not found" },
  );
  for (const savedLinkId of ["   ", "x".repeat(129)]) {
    await assert.rejects(
      () => runner.act(stored.id, {
        action: "attach-saved-link",
        savedLinkId,
        familiarId: "sage",
      }),
      { message: "saved link id is invalid" },
    );
  }
  assert.equal(reconciliations, 0);
  assert.equal(sessionOwnerLoads, 0);
  assert.equal(materializations, 0);
  assert.equal(saves, 0);
});

test("attach-saved-link compensates its materialized file if the mission save fails", async () => {
  const stored = checkpointMission();
  let rollbacks = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async () => { throw new Error("mission save failed"); },
    materializeSavedLink: async () => ({
      source: {
        id: "saved-0123456789abcdef01234567",
        title: "Durable research",
        localPath: "source-files/x-article-0123456789abcdef01234567.md",
        sourceType: "x-article",
        status: "candidate",
      },
      rollback: async () => { rollbacks += 1; },
    }),
  }));

  await assert.rejects(
    () => runner.act(stored.id, {
      action: "attach-saved-link",
      savedLinkId: "saved-link-1",
      familiarId: "sage",
    }),
    { message: "mission save failed" },
  );
  assert.equal(rollbacks, 1);
});

test("attach-saved-link does not save when materialization fails", async () => {
  const stored = checkpointMission();
  let saves = 0;
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async () => { saves += 1; },
    materializeSavedLink: async () => { throw new Error("saved X Article not found"); },
  }));

  await assert.rejects(
    () => runner.act(stored.id, {
      action: "attach-saved-link",
      savedLinkId: "saved-link-1",
      familiarId: "sage",
    }),
    { message: "saved X Article not found" },
  );
  assert.equal(saves, 0);
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
