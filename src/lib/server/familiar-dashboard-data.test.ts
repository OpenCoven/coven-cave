// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  serializedDashboardBytes,
} from "../familiar-dashboard.ts";
import {
  DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES,
  loadFamiliarDashboard,
  type FamiliarDashboardDependencies,
} from "./familiar-dashboard-data.ts";
import { listDashboardMetricSnapshots } from "./familiar-self-reports.ts";

const NOW = Date.parse("2026-08-07T20:00:00.000Z");
const CONFIG = {
  version: 1,
  defaults: { harness: "claude", model: "claude-sonnet" },
  familiars: { sage: { model: "gpt-5.3-codex" } },
  roles: [],
  marketplace: { installed: {} },
  multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  omnigent: {
    enabled: false,
    baseUrl: "",
    defaultAgentId: "",
    defaultHostId: "",
    defaultWorkspace: "",
    hostMap: {},
    hostWorkspaceMap: {},
    exposeHostsInComposer: false,
  },
  remoteHosts: [],
};

function makeDependencies(
  overrides: Partial<FamiliarDashboardDependencies> = {},
): FamiliarDashboardDependencies {
  return {
    now: () => NOW,
    loadRoster: async () => ({
      ok: true,
      config: CONFIG,
      target: {
        mode: "local",
        label: "Local daemon",
        socketPath: "/var/run/coven.sock",
      },
      roster: [{
        id: "sage",
        display_name: "Sage",
        role: "Researcher",
        status: "online",
        active_sessions: 1,
      }],
    }),
    enrichFamiliar: async (familiar) => ({
      ...familiar,
      harness: "claude",
      defaultHarness: "claude",
      harnessOverride: null,
      model: "gpt-5.3-codex",
    }),
    loadBoard: async () => ({ version: 1, cards: [] }),
    loadSessions: async () => ({ payload: { ok: true, sessions: [] } }),
    loadInbox: async () => ({ version: 1, items: [] }),
    loadContract: async () => ({
      files: { soul: null, identity: null, ward: null, memory: null },
      report: {
        specVersion: "0.1.0",
        pass: false,
        properties: [],
        violations: [],
        warnings: [],
      },
    }),
    loadAccess: async () => ({ projects: [] }),
    loadMemory: async () => ({
      entries: [],
      overview: {
        generatedAt: new Date(NOW).toISOString(),
        totals: {
          entries: 0,
          familiars: 0,
          verified: 0,
          needsReview: 0,
          unknown: 0,
        },
        lastUpdatedAt: null,
        capabilities: {
          detail: true,
          verification: true,
          attestationMetadata: true,
          supersessionHistory: true,
          mutations: true,
        },
        verification: {
          state: "verified",
          checkedAt: new Date(NOW).toISOString(),
          manifest: null,
          index: null,
          issues: [],
        },
      },
    }),
    loadRetro: async () => ({
      ok: true,
      snapshot: {
        generatedAt: new Date(NOW).toISOString(),
        summary: {
          totalRuns: 0,
          accepted: 0,
          reverted: 0,
          runningFamiliars: 0,
          familiarsWithData: 0,
          trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
          lastRun: null,
        },
        familiars: [],
        runs: [],
      },
    }),
    loadReports: async () => ({ reports: [], total: 0 }),
    loadMetricSnapshots: async () => ({ snapshots: [], total: 0 }),
    loadFeedback: async () => [],
    ...overrides,
  };
}

function taskFixture(index: number) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `task-${index}`,
    title: `Task ${index}`,
    notes: "",
    status: "running",
    priority: "medium",
    familiarId: "sage",
    sessionId: null,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: updatedAt,
    updatedAt,
    lifecycle: "running",
    lifecycleAt: updatedAt,
    retryCount: 0,
    maxRetries: 2,
    steps: [],
    dependencies: [],
    primaryBlockerId: null,
    nextStep: {
      summary: "Continue the assigned task",
      requiresApproval: false,
      origin: "human",
      updatedAt,
    },
  };
}

function sessionFixture(index: number) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `session-${index}`,
    project_root: "/repo",
    harness: "claude",
    model: "claude-sonnet",
    runtime: "local",
    title: `Session ${index}`,
    status: index === 0 ? "running" : "completed",
    exit_code: 0,
    archived_at: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    familiarId: "sage",
    origin: "chat",
    generated: false,
  };
}

function reminderFixture(index: number) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `reminder-${index}`,
    kind: "reminder",
    title: `Reminder ${index}`,
    body: null,
    status: "pending",
    createdAt: updatedAt,
    updatedAt,
    fireAt: null,
    recurrence: { type: "none" },
    source: "user",
    familiarId: "sage",
  };
}

function reportFixture(index: number) {
  const reportedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `report-${index}`,
    familiarId: "sage",
    sessionId: `session-${index}`,
    threadTitle: `Thread ${index}`,
    reportedAt,
    overallConfidence: 70,
    overallConfidenceReason: "Evidence verified.",
    toolReliability: {
      score: 80,
      failedTools: [],
      unreliableTools: [],
    },
    contextPressure: "adequate",
    skillsUsed: ["web-search"],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesLacking: [],
    capabilitiesVital: [{
      name: "shell",
      currentState: "available",
    }],
    memoryRecallScore: 60,
    fileLocatabilityScore: 90,
    persistentBlockers: [],
  };
}

function snapshotFixture(index: number) {
  return {
    id: `snapshot-${index}`,
    sessionId: `session-${index}`,
    reportedAt: new Date(NOW - index * 60_000).toISOString(),
    confidence: 70,
    toolReliability: 80,
    memoryRecall: 60,
    fileLocatability: 90,
    contextPressure: "adequate",
  };
}

test("unknown Familiar stops after roster resolution", async () => {
  let boardCalls = 0;
  const result = await loadFamiliarDashboard("missing", makeDependencies({
    loadBoard: async () => {
      boardCalls++;
      return { version: 1, cards: [] };
    },
  }));
  assert.deepEqual(result, { kind: "not_found" });
  assert.equal(boardCalls, 0);
});

test("known Familiar returns 200-shaped partial data when one source fails", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: async () => {
      throw new Error("/Users/private/board.json token=secret");
    },
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "partial");
  assert.deepEqual(result.response.sections.overview.issues, [{
    source: "board",
    code: "board_unavailable",
  }]);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("successful record sources produce fresh sections", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: async () => ({
      version: 1,
      cards: [taskFixture(0)],
    }),
    loadSessions: async () => ({
      payload: { ok: true, sessions: [sessionFixture(0)] },
    }),
    loadInbox: async () => ({
      version: 1,
      items: [reminderFixture(0)],
    }),
    loadReports: async () => ({
      reports: [reportFixture(0)],
      total: 1,
    }),
    loadMetricSnapshots: async () => ({
      snapshots: [snapshotFixture(0)],
      total: 1,
    }),
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "fresh");
  assert.equal(result.response.sections.profile.state, "fresh");
  assert.equal(result.response.sections.analytics.state, "fresh");
});

test("successful empty stores produce truthful empty data states", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies());
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "empty");
  assert.equal(result.response.sections.overview.data.tasks.total, 0);
  assert.equal(result.response.sections.analytics.state, "empty");
  assert.equal(result.response.sections.analytics.data.activity.totalSessions, 0);
  assert.equal(result.response.sections.profile.state, "fresh");
});

test("every source failure is independent", async () => {
  const dependencyKeys = [
    "enrichFamiliar",
    "loadBoard",
    "loadSessions",
    "loadInbox",
    "loadContract",
    "loadAccess",
    "loadMemory",
    "loadRetro",
    "loadReports",
    "loadMetricSnapshots",
    "loadFeedback",
  ];
  for (const key of dependencyKeys) {
    const result = await loadFamiliarDashboard("sage", makeDependencies({
      [key]: async () => { throw new Error(`raw-${key}-secret`); },
    }));
    assert.equal(result.kind, "ok", `${key} does not erase the known Familiar`);
    assert.equal(JSON.stringify(result).includes(`raw-${key}-secret`), false);
  }
});

test("multiple failures affect only the sections that consume them", async () => {
  const fail = async () => { throw new Error("private failure detail"); };
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: fail,
    loadReports: fail,
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "partial");
  assert.equal(result.response.sections.analytics.state, "partial");
  assert.equal(result.response.sections.profile.state, "fresh");
  assert.equal(JSON.stringify(result).includes("private failure detail"), false);
});

test("all required Overview sources failing yields unavailable only for Overview", async () => {
  const fail = async () => { throw new Error("source failed"); };
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: fail,
    loadSessions: fail,
    loadInbox: fail,
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "unavailable");
  assert.equal(result.response.sections.overview.data, null);
  assert.notEqual(result.response.sections.profile.state, "unavailable");
});

test("degraded local sessions remain usable and make required sections partial", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadSessions: async () => ({
      payload: {
        ok: true,
        degraded: true,
        error: "daemon token=secret",
        sessions: [sessionFixture(0)],
      },
    }),
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "partial");
  assert.equal(result.response.sections.overview.data.sessions.totalNonGenerated, 1);
  assert.deepEqual(
    result.response.sections.overview.issues.find(
      (issue) => issue.source === "sessions",
    ),
    { source: "sessions", code: "sessions_degraded" },
  );
  assert.equal(JSON.stringify(result).includes("daemon token=secret"), false);
});

test("roster failure yields no safe dashboard", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadRoster: async () => ({
      ok: false,
      config: CONFIG,
      target: {
        mode: "local",
        label: "Local daemon",
        socketPath: "/var/run/coven.sock",
      },
      status: 503,
      error: "daemon token=secret",
    }),
  }));
  assert.deepEqual(result, { kind: "unavailable" });
});

test("production bounds are applied before serialization", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadReports: async () => ({
      reports: Array.from({ length: 40 }, (_, index) => reportFixture(index)),
      total: 40,
    }),
    loadMetricSnapshots: async () => ({
      snapshots: Array.from({ length: 140 }, (_, index) => snapshotFixture(index)),
      total: 140,
    }),
    loadSessions: async () => ({
      payload: {
        ok: true,
        sessions: Array.from({ length: 130 }, (_, index) => sessionFixture(index)),
      },
    }),
  }));
  assert.equal(result.kind, "ok");
  assert.ok(
    serializedDashboardBytes(result.response) <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
  );
  assert.equal(result.response.sections.analytics.data.confidence.sampleCount, 30);
  assert.ok(result.response.sections.analytics.data.trends.sampleCount <= 100);
});

test("default dashboard dependencies use the bounded metric snapshot query", () => {
  assert.equal(
    DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES.loadMetricSnapshots,
    listDashboardMetricSnapshots,
  );
});

test("response stays within budget with 5000 accessible projects", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadAccess: async () => ({
      projects: Array.from({ length: 5000 }, (_, index) => {
        const label = String(5000 - index).padStart(4, "0");
        return {
          project: {
            id: `project-${label}`,
            name: `Project ${label}`,
            root: `/repo/${index}`,
          },
          access: index % 2 === 0 ? "write" : "read",
        };
      }),
    }),
  }));
  assert.equal(result.kind, "ok");
  const projects = result.response.sections.profile.data.access.projects;
  assert.equal(projects.total, 5000);
  assert.equal(projects.items.length, FAMILIAR_DASHBOARD_LIMITS.accessProjects);
  assert.deepEqual(projects.items.slice(0, 3), [
    { id: "project-0001", name: "Project 0001", access: "read" },
    { id: "project-0002", name: "Project 0002", access: "write" },
    { id: "project-0003", name: "Project 0003", access: "read" },
  ]);
  assert.ok(
    serializedDashboardBytes(result.response) <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
  );
});
