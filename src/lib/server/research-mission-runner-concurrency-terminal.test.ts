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

