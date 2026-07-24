import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationFile } from "../cave-conversations.ts";
import type { AutomationRunRecord } from "../automation-runs.ts";
import type { FlowRunRecord } from "../flows.ts";
import { allowedResearchActions, type ResearchMission } from "../research-missions.ts";
import type { KnowledgeEntry } from "./knowledge-vault.ts";
import {
  makeResearchMissionRunner,
  parseResearchSourcesFile,
  reconcileResearchMissionList,
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

test("a mission with no artifact refs reconciles instead of throwing", async () => {
  const published: string[] = [];
  let stored = checkpointMission({
    status: "running",
    artifacts: [],
    iterations: [{
      ...checkpointMission().iterations[0],
      status: "running",
      finishedAt: undefined,
    }],
  });
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
    readMissionFile: async () => "# Complete\n",
    publishKnowledge: async (entry) => { published.push(entry.body); return entry; },
  }));
  const result = await runner.reconcile(stored);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.artifacts, [], "no artifact ref may be invented");
  assert.deepEqual(published, [], "nothing publishes without an artifact ref");
});

test("manually attached sources survive evidence reconciliation", async () => {
  let stored = checkpointMission({
    status: "running",
    iterations: [{
      ...checkpointMission().iterations[0],
      status: "running",
      finishedAt: undefined,
    }],
    sources: [
      {
        id: "manual-memo",
        title: "Manual memo",
        url: "https://example.com/manual-memo",
        sourceType: "web",
        status: "candidate",
      },
      {
        id: "manual-dup",
        title: "Stale manual copy",
        url: "https://example.com/source",
        sourceType: "web",
        status: "candidate",
      },
    ],
  });
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
    readMissionFile: async () => "# Complete\n",
    readSources: async () => [{
      id: "source-1",
      title: "Primary source",
      url: "https://example.com/source",
      sourceType: "web",
      status: "used",
    }],
  }));
  const result = await runner.reconcile(stored);
  assert.equal(result.sources.length, 2);
  const manual = result.sources.find((source) => source.id === "manual-memo");
  assert.ok(manual, "the manual-only source must survive the reconcile");
  assert.equal(manual?.status, "candidate");
  const collided = result.sources.find((source) => source.url === "https://example.com/source");
  assert.equal(collided?.id, "source-1", "the flow-written entry wins a url collision");
  assert.equal(collided?.status, "used");
});

test("one poisoned mission degrades to its stored snapshot instead of failing the list", async () => {
  const poisoned = checkpointMission({ id: "mission-poisoned" });
  const healthy = checkpointMission({ id: "mission-healthy" });
  let healthyReconciles = 0;
  const runner = {
    reconcile: async (mission: ResearchMission): Promise<ResearchMission> => {
      if (mission.id === "mission-poisoned") throw new Error("boom");
      healthyReconciles += 1;
      return { ...mission, lastError: "reconciled" };
    },
    reconcileAutomation: async (mission: ResearchMission): Promise<ResearchMission> => mission,
  };
  const result = await reconcileResearchMissionList([poisoned, healthy], runner);
  assert.equal(result.length, 2, "the list endpoint must keep serving");
  assert.deepEqual(result[0], poisoned, "the poisoned mission falls back to its stored snapshot");
  assert.equal(result[1].lastError, "reconciled");
  assert.equal(healthyReconciles, 1);
});

// ── Publish every final artifact on complete, not only the primary ─────────
// Every mission carries four standard refs (primary, findings, source-ledger,
// research-log — cave research-final-artifacts Task 3). A `complete` decision
// must publish all of them, with per-artifact failure isolation: one failed
// vault write or missing file may never block the mission's terminal state
// or the other refs.

const FOUR_REFS: ResearchMission["artifacts"] = [
  { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
  { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
  { key: "source-ledger", kind: "source-ledger", title: "Source ledger", relativePath: "sources.json", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
  { key: "research-log", kind: "research-log", title: "Research log", relativePath: "research-log.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
];

function completingRunDeps(
  stored: { mission: ResearchMission },
  overrides: Partial<ResearchMissionRunnerDeps> = {},
): ResearchMissionRunnerDeps {
  return deps({
    loadMission: async () => structuredClone(stored.mission),
    saveMission: async (mission) => { stored.mission = structuredClone(mission); },
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
    readMissionFile: async (_id, relativePath) => `# Content of ${relativePath}\n`,
    ...overrides,
  });
}

test("complete publishes all four final artifacts to the vault", async () => {
  const stored: { mission: ResearchMission } = {
    mission: checkpointMission({
      status: "running",
      artifacts: FOUR_REFS,
      iterations: [{
        ...checkpointMission().iterations[0],
        status: "running",
        finishedAt: undefined,
      }],
    }),
  };
  const published: KnowledgeEntry[] = [];
  const runner = makeResearchMissionRunner(completingRunDeps(stored, {
    readSources: async () => [{
      id: "s1",
      title: "SQLite docs",
      url: "https://sqlite.org",
      sourceType: "web",
      status: "used",
    }],
    publishKnowledge: async (entry) => { published.push(entry); return entry; },
  }));
  const result = await runner.reconcile(stored.mission);
  assert.equal(result.status, "completed");
  assert.equal(result.lastError, undefined);
  assert.deepEqual(
    published.map((entry) => entry.id).sort(),
    [
      `research-${result.id}-findings`,
      `research-${result.id}-primary`,
      `research-${result.id}-research-log`,
      `research-${result.id}-source-ledger`,
    ],
  );
  const ledger = published.find((entry) => entry.id === `research-${result.id}-source-ledger`);
  assert.match(ledger?.body ?? "", /SQLite docs/);
  assert.equal(result.artifacts.length, 4);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.state, "published");
    assert.ok(artifact.knowledgeId, `${artifact.key} must carry a knowledgeId`);
  }
});

test("checkpoint publishes nothing but bumps every working ref", async () => {
  const stored: { mission: ResearchMission } = {
    mission: checkpointMission({
      status: "running",
      artifacts: FOUR_REFS,
      iterations: [{
        number: 2,
        status: "running",
        flowRunId: "run-1",
        sessionId: "session-1",
        startedAt: NOW.toISOString(),
      }],
    }),
  };
  const published: KnowledgeEntry[] = [];
  const runner = makeResearchMissionRunner(completingRunDeps(stored, {
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
          '{"decision":"checkpoint","reason":"More to gather","confidence":0.5}',
          "@@research-artifacts-written",
        ].join("\n"),
        createdAt: NOW.toISOString(),
      }],
    }),
    publishKnowledge: async (entry) => { published.push(entry); return entry; },
  }));
  const result = await runner.reconcile(stored.mission);
  assert.equal(result.status, "checkpoint");
  assert.equal(published.length, 0);
  assert.equal(result.artifacts.length, 4);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.state, "working");
    assert.equal(artifact.iteration, 2);
  }
});

test("a single publish failure is isolated", async () => {
  const stored: { mission: ResearchMission } = {
    mission: checkpointMission({
      status: "running",
      artifacts: FOUR_REFS,
      iterations: [{
        ...checkpointMission().iterations[0],
        status: "running",
        finishedAt: undefined,
      }],
    }),
  };
  const published: KnowledgeEntry[] = [];
  const runner = makeResearchMissionRunner(completingRunDeps(stored, {
    publishKnowledge: async (entry) => {
      if (entry.id.endsWith("-findings")) throw new Error("vault write failed");
      published.push(entry);
      return entry;
    },
  }));
  const result = await runner.reconcile(stored.mission);
  assert.equal(result.status, "completed");
  assert.match(result.lastError ?? "", /findings: vault write failed/);
  const findings = result.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(findings?.state, "working");
  assert.equal(findings?.knowledgeId, undefined);
  assert.equal(published.length, 3);
});

test("a missing standard file fails only that artifact", async () => {
  const stored: { mission: ResearchMission } = {
    mission: checkpointMission({
      status: "running",
      artifacts: FOUR_REFS,
      iterations: [{
        ...checkpointMission().iterations[0],
        status: "running",
        finishedAt: undefined,
      }],
    }),
  };
  const published: KnowledgeEntry[] = [];
  const runner = makeResearchMissionRunner(completingRunDeps(stored, {
    readMissionFile: async (_id, relativePath) => (
      relativePath === "research-log.md" ? null : `# Content of ${relativePath}\n`
    ),
    publishKnowledge: async (entry) => { published.push(entry); return entry; },
  }));
  const result = await runner.reconcile(stored.mission);
  assert.equal(result.status, "completed");
  assert.match(result.lastError ?? "", /research-log: file missing/);
  const researchLog = result.artifacts.find((artifact) => artifact.key === "research-log");
  assert.equal(researchLog?.state, "working");
  assert.equal(researchLog?.knowledgeId, undefined);
  assert.equal(published.length, 3);
});
