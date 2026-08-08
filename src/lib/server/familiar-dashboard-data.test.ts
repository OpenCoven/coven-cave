// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import {
  listDashboardMetricSnapshots,
  listDashboardSelfReports,
} from "./familiar-self-reports.ts";
import { loadCachedSessionsList } from "./sessions-list-cache.ts";

const NOW = Date.parse("2026-08-07T20:00:00.000Z");
const TASK_DEPENDENCY_LIMIT = 6;
const FEEDBACK_BUCKET_LIMIT = 25;
const ACCESS_PROJECT_LIMIT = 50;
const CAPABILITY_USED_LIMIT = 5;
const CAPABILITY_LACKING_LIMIT = 12;
const CAPABILITY_VITAL_LIMIT = 12;
const HEAL_REQUEST_LIMIT = 8;
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

function emptyFeedbackRollup() {
  return {
    rollup: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    freshness: null,
  };
}

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
    loadMemory: async () => [],
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
    loadFeedback: async () => emptyFeedbackRollup(),
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

function reportFixture(
  index: number,
  overrides: Record<string, unknown> = {},
) {
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
    ...overrides,
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

for (const status of [401, 403] as const) {
  test(`roster auth ${status} preserves a safe auth outcome`, async () => {
    const result = await loadFamiliarDashboard("sage", makeDependencies({
      loadRoster: async () => ({
        ok: false,
        config: CONFIG,
        target: {
          mode: "hub",
          label: "Server hub",
          url: "https://hub.example",
        },
        status,
        error: "upstream token=secret",
      }),
    }));

    assert.deepEqual(result, { kind: "auth_error", status });
  });
}

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

test("analytics stays non-empty when heal requests are actionable", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadContract: async () => ({
      files: { soul: null, identity: null, ward: null, memory: null },
      report: {
        specVersion: "0.1.0",
        pass: false,
        properties: [],
        violations: [{
          file: "SOUL.md",
          field: "purpose",
          message: "Purpose is missing.",
        }],
        warnings: [],
      },
    }),
  }));

  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.analytics.state, "fresh");
  assert.equal(result.response.sections.analytics.data.healRequests.length, 1);
});

test("analytics stays non-empty when feedback exists", async () => {
  const feedbackFreshness = "2026-08-07T19:57:00.000Z";
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadFeedback: async () => ({
      rollup: {
        up: 1,
        down: 0,
        total: 1,
        models: [{
          key: "claude-sonnet",
          up: 1,
          down: 0,
          total: 1,
          approval: 1,
        }],
        runtimes: [],
      },
      freshness: feedbackFreshness,
    }),
  }));

  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.analytics.state, "fresh");
  assert.equal(result.response.sections.analytics.data.feedback.total, 1);
  assert.equal(
    result.response.sections.analytics.data.feedback.freshness,
    feedbackFreshness,
  );
});

test("empty dashboard feedback keeps null freshness", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadFeedback: async () => ({
      rollup: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
      freshness: "2026-08-07T19:57:00.000Z",
    }),
  }));

  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.analytics.data.feedback.total, 0);
  assert.equal(result.response.sections.analytics.data.feedback.freshness, null);
});

test("analytics is empty only when every visible signal is zero or absent", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies());

  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.analytics.state, "empty");
  assert.equal(result.response.sections.analytics.data.activity.totalSessions, 0);
  assert.equal(result.response.sections.analytics.data.confidence.sampleCount, 0);
  assert.equal(result.response.sections.analytics.data.trends.sampleCount, 0);
  assert.equal(result.response.sections.analytics.data.memory.count, 0);
  assert.equal(result.response.sections.analytics.data.capabilities.used.length, 0);
  assert.equal(result.response.sections.analytics.data.capabilities.lacking.length, 0);
  assert.equal(result.response.sections.analytics.data.capabilities.vital.length, 0);
  assert.equal(result.response.sections.analytics.data.healRequests.length, 0);
  assert.equal(result.response.sections.analytics.data.feedback.total, 0);
});

test("memory analytics depend only on canonical list entries", async () => {
  const updatedAt = "2026-08-07T19:59:00.000Z";
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadMemory: async () => [{
      id: "memory-1",
      familiarId: "sage",
      title: "Remember the source contract",
      updatedAt,
      relativeUpdatedAt: "1 minute ago",
      excerpt: "The dashboard consumes list entries only.",
      source: { kind: "journal", label: "Journal" },
      privacy: { classification: null, revealRequired: false },
      verification: { state: "verified" },
    }],
  }));

  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.analytics.state, "fresh");
  assert.deepEqual(result.response.sections.analytics.issues, []);
  assert.deepEqual(result.response.sections.analytics.data.memory, {
    definition: "Canonical memory availability and report-backed recall signals.",
    period: "current memory plus latest 30 reports",
    sampleCount: 0,
    freshness: updatedAt,
    availability: "ready",
    count: 1,
    latestUpdatedAt: updatedAt,
    averageRecall: null,
    averageFileLocatability: null,
  });
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

test("enrichment failure never publishes guessed Profile config and preserves independent sections", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadRoster: async () => ({
      ok: true,
      config: {
        ...CONFIG,
        familiars: {
          sage: {
            display_name: "Configured Sage",
            role: "Planner",
            harness: "codex",
            model: "gpt-5.3-codex",
            autoSelfReport: true,
            asanaEnabled: false,
            xResearchEnabled: true,
            xPublishEnabled: false,
          },
        },
      },
      target: {
        mode: "local",
        label: "Local daemon",
        socketPath: "/var/run/coven.sock",
      },
      roster: [{
        id: "sage",
        display_name: "Roster Sage",
        role: "Researcher",
        status: "online",
        active_sessions: 1,
      }],
    }),
    enrichFamiliar: async () => {
      throw new Error("/Users/private/familiar-config token=secret");
    },
  }));

  assert.equal(result.kind, "ok");
  assert.equal(result.response.identity.displayName, "Roster Sage");
  assert.equal(result.response.sections.profile.state, "unavailable");
  assert.equal(result.response.sections.profile.data, null);
  assert.deepEqual(result.response.sections.profile.issues, [{
    source: "familiar",
    code: "familiar_enrichment_unavailable",
  }]);
  assert.equal(result.response.sections.overview.state, "empty");
  assert.equal(result.response.sections.overview.data.live.harness, null);
  assert.equal(result.response.sections.overview.data.live.model, null);
  assert.deepEqual(result.response.sections.overview.issues, []);
  assert.equal(result.response.sections.analytics.state, "empty");
  assert.deepEqual(result.response.sections.analytics.issues, []);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
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

test("degraded session rows keep Overview and Analytics partial when other required sources fail", async () => {
  const fail = async () => { throw new Error("source failed"); };
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: fail,
    loadSessions: async () => ({
      payload: {
        ok: true,
        degraded: true,
        error: "daemon unavailable",
        sessions: [sessionFixture(0)],
      },
    }),
    loadInbox: fail,
    loadReports: fail,
    loadMetricSnapshots: fail,
    loadMemory: fail,
  }));

  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "partial");
  assert.notEqual(result.response.sections.overview.data, null);
  assert.equal(result.response.sections.overview.data.sessions.totalNonGenerated, 1);
  assert.deepEqual(
    result.response.sections.overview.issues.find(
      (issue) => issue.source === "sessions",
    ),
    { source: "sessions", code: "sessions_degraded" },
  );

  assert.equal(result.response.sections.analytics.state, "partial");
  assert.notEqual(result.response.sections.analytics.data, null);
  assert.equal(result.response.sections.analytics.data.activity.totalSessions, 1);
  assert.equal(result.response.sections.analytics.data.activity.evidenceCount, 1);
  assert.deepEqual(
    result.response.sections.analytics.issues.find(
      (issue) => issue.source === "sessions",
    ),
    { source: "sessions", code: "sessions_degraded" },
  );
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

test("response stays within budget with oversized self-report capabilities and other bounded previews", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: async () => ({
      version: 1,
      cards: [{
        ...taskFixture(0),
        status: "blocked",
        dependencies: Array.from({ length: 30 }, (_, index) => ({
          id: `dep-${index}`,
          kind: "task",
          label: `Dependency ${index}`,
          taskId: `task-${index}`,
          state: "unresolved",
          origin: "human",
          createdAt: new Date(NOW - index * 60_000).toISOString(),
        })),
        primaryBlockerId: "dep-29",
      }],
    }),
    loadContract: async () => ({
      files: { soul: null, identity: null, ward: null, memory: null },
      report: {
        specVersion: "0.1.0",
        pass: false,
        properties: [],
        violations: Array.from({ length: 20 }, (_, index) => ({
          file: "SOUL.md",
          field: `field-${index}`,
          message: `Violation ${index}`,
        })),
        warnings: [],
      },
    }),
    loadReports: async () => ({
      reports: [reportFixture(0, {
        skillsUsed: Array.from(
          { length: 400 },
          (_, index) => `skill-${String(399 - index).padStart(3, "0")}`,
        ),
        capabilitiesLacking: Array.from({ length: 400 }, (_, index) => ({
          name: `lacking-${String(399 - index).padStart(3, "0")}`,
          importance: "blocking",
          detail: `Missing capability ${index}`,
        })),
        capabilitiesVital: Array.from({ length: 400 }, (_, index) => ({
          name: `vital-${String(399 - index).padStart(3, "0")}`,
          currentState: "missing",
          notes: `Vital note ${index}`,
        })),
      }), reportFixture(1)],
      total: 2,
    }),
  }));

  assert.equal(result.kind, "ok");
  const overviewTask = result.response.sections.overview.data.tasks.items[0];
  const analytics = result.response.sections.analytics.data;
  assert.equal(
    overviewTask.dependencies.length,
    TASK_DEPENDENCY_LIMIT,
  );
  assert.equal(
    analytics.capabilities.used.length,
    CAPABILITY_USED_LIMIT,
  );
  assert.deepEqual(analytics.capabilities.used.map((entry) => entry.name), [
    "skill-000",
    "skill-001",
    "skill-002",
    "skill-003",
    "skill-004",
  ]);
  assert.equal(
    analytics.capabilities.lacking.length,
    CAPABILITY_LACKING_LIMIT,
  );
  assert.equal(
    analytics.capabilities.vital.length,
    CAPABILITY_VITAL_LIMIT,
  );
  assert.equal(
    analytics.healRequests.length,
    HEAL_REQUEST_LIMIT,
  );
  assert.ok(
    serializedDashboardBytes(result.response) <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
  );
});

test("overview heal attention keeps the derived request timestamp non-null", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadContract: async () => ({
      files: { soul: null, identity: null, ward: null, memory: null },
      report: {
        specVersion: "0.1.0",
        pass: false,
        properties: [],
        violations: [{
          file: "SOUL.md",
          field: "purpose",
          message: "Purpose is missing.",
        }],
        warnings: [],
      },
    }),
  }));

  assert.equal(result.kind, "ok");
  assert.equal(
    result.response.sections.overview.data.attention.items[0]?.updatedAt,
    new Date(NOW).toISOString(),
  );
});

test("default dashboard dependencies use the shared cached sessions reader", () => {
  assert.equal(
    DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES.loadSessions,
    loadCachedSessionsList,
  );
});

test("default dashboard dependencies use bounded report and metric readers", () => {
  assert.equal(
    DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES.loadReports,
    listDashboardSelfReports,
  );
  assert.equal(
    DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES.loadMetricSnapshots,
    listDashboardMetricSnapshots,
  );
});

test("default dashboard memory loader has no overview dependency", () => {
  assert.equal(
    DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES.loadMemory.name,
    "loadCachedCanonicalMemorySummariesForFamiliar",
  );

  const source = readFileSync(
    new URL("./familiar-dashboard-data.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /import \{\s*loadCachedCanonicalMemorySummariesForFamiliar,\s*\} from "@\/lib\/server\/canonical-memory-gateway";/,
  );
  assert.doesNotMatch(source, /canonicalMemoryList,/);
  assert.doesNotMatch(source, /canonicalMemoryOverview/);
});

test("response stays within budget with thousands of distinct feedback buckets", async () => {
  const hugeBucketCount = 5000;
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadFeedback: async () => ({
      rollup: {
        up: hugeBucketCount * 2,
        down: hugeBucketCount,
        total: hugeBucketCount * 3,
        models: Array.from({ length: hugeBucketCount }, (_, index) => ({
          key: `model-${String(hugeBucketCount - index - 1).padStart(4, "0")}`,
          up: 2,
          down: 1,
          total: 3,
          approval: 2 / 3,
        })),
        runtimes: Array.from({ length: hugeBucketCount }, (_, index) => ({
          key: `runtime-${String(hugeBucketCount - index - 1).padStart(4, "0")}`,
          up: 2,
          down: 1,
          total: 3,
          approval: 2 / 3,
        })),
      },
      freshness: "2026-08-07T19:59:00.000Z",
    }),
  }));

  assert.equal(result.kind, "ok");
  const feedback = result.response.sections.analytics.data.feedback;
  assert.deepEqual(
    { up: feedback.up, down: feedback.down, total: feedback.total },
    { up: hugeBucketCount * 2, down: hugeBucketCount, total: hugeBucketCount * 3 },
  );
  assert.equal(feedback.models.length, FEEDBACK_BUCKET_LIMIT);
  assert.equal(feedback.runtimes.length, FEEDBACK_BUCKET_LIMIT);
  assert.deepEqual(
    feedback.models.slice(0, 3).map((slice) => slice.key),
    ["model-0000", "model-0001", "model-0002"],
  );
  assert.ok(
    serializedDashboardBytes(result.response) <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
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
  assert.equal(projects.items.length, ACCESS_PROJECT_LIMIT);
  assert.deepEqual(projects.items.slice(0, 3), [
    { id: "project-0001", name: "Project 0001", access: "read" },
    { id: "project-0002", name: "Project 0002", access: "write" },
    { id: "project-0003", name: "Project 0003", access: "read" },
  ]);
  assert.ok(
    serializedDashboardBytes(result.response) <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
  );
});
