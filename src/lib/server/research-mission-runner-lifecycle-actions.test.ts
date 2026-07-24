import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationFile } from "../cave-conversations.ts";
import type { AutomationRunRecord } from "../automation-runs.ts";
import type { FlowRunRecord } from "../flows.ts";
import { allowedResearchActions, type ResearchMission, type ResearchSourcePatch } from "../research-missions.ts";
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

test("every launch grants the mission workspace as a harness trust dir", async () => {
  // A configured project root moves the spawn cwd away from the workspace;
  // without an --add-dir grant a non-interactive run cannot write there and
  // the iteration ends with "completed without artifacts/primary.md".
  const grants: Array<string[] | undefined> = [];
  const runner = makeResearchMissionRunner(deps({
    startFlow: async (_flow, options) => {
      grants.push(options.addDirs);
      return { ok: true, run: RUN, sessionId: "session-1", executor: "session" };
    },
  }));
  await runner.createAndStart({ ...INPUT, projectRoot: "/allowed/repo" });
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
    "Artifact publish failed — findings: vault write failed",
    "publish-failure lastError stays until no unpublished working refs remain",
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
    [{ status: "running" }, "primary", "research mission is still running"],
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
