// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
  buildFamiliarAnalyticsDigest,
  buildFamiliarOverview,
  buildFamiliarProfile,
  buildDashboardSection,
  isFamiliarAnalyticsDigestEmpty,
  serializedDashboardBytes,
} from "./familiar-dashboard.ts";

const NOW = Date.parse("2026-08-07T20:00:00.000Z");
const TASK_DEPENDENCY_LIMIT = 6;
const ACCESS_PROJECT_LIMIT = 50;
const CAPABILITY_LACKING_LIMIT = 12;
const CAPABILITY_VITAL_LIMIT = 12;
const HEAL_REQUEST_LIMIT = 8;

test("published limits match the v1 contract", () => {
  assert.equal(FAMILIAR_DASHBOARD_VERSION, 1);
  assert.deepEqual(FAMILIAR_DASHBOARD_LIMITS, {
    responseBytes: 131072,
    assignedTasks: 6,
    activeSessions: 3,
    recentSessions: 5,
    attention: 6,
    reminders: 5,
    reports: 30,
    metricSnapshots: 100,
    metricTrailingDays: 30,
    sessionEvidence: 100,
    sessionPulseDays: 14,
  });
});

test("Overview selects the newest running non-generated session for Now", () => {
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [],
    sessions: [
      modelSession(1, {
        id: "generated",
        status: "running",
        generated: true,
        title: "Automation",
        updated_at: "2026-08-07T19:59:00.000Z",
      }),
      modelSession(2, {
        id: "chat-2",
        status: " Waiting ",
        title: "Await approval",
        updated_at: "2026-08-07T19:58:30.000Z",
      }),
      modelSession(3, {
        id: "chat-1",
        status: "running",
        title: "Investigate regression",
        updated_at: "2026-08-07T19:58:00.000Z",
      }),
    ],
    reminders: [],
    healRequests: [],
    now: NOW,
  });

  assert.deepEqual(overview.now, {
    kind: "session",
    id: "chat-1",
    title: "Investigate regression",
    updatedAt: "2026-08-07T19:58:00.000Z",
  });
  assert.equal(overview.sessions.activeTotal, 2);
  assert.equal(overview.sessions.totalNonGenerated, 2);
});

test("Overview excludes archived sessions from active and recent lists", () => {
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [],
    sessions: [
      modelSession(1, {
        id: "archived-running",
        status: "running",
        title: "Hidden active chat",
        updated_at: "2026-08-07T19:59:30.000Z",
        archived_at: "2026-08-07T20:00:00.000Z",
      }),
      modelSession(2, {
        id: "visible-running",
        status: "running",
        title: "Visible active chat",
        updated_at: "2026-08-07T19:59:00.000Z",
      }),
      modelSession(3, {
        id: "archived-complete",
        status: "completed",
        title: "Hidden finished chat",
        updated_at: "2026-08-07T19:58:30.000Z",
        archived_at: "2026-08-07T19:58:45.000Z",
      }),
      modelSession(4, {
        id: "visible-complete",
        status: "completed",
        title: "Visible finished chat",
        updated_at: "2026-08-07T19:58:00.000Z",
      }),
    ],
    reminders: [],
    healRequests: [],
    now: NOW,
  });

  assert.deepEqual(overview.now, {
    kind: "session",
    id: "visible-running",
    title: "Visible active chat",
    updatedAt: "2026-08-07T19:59:00.000Z",
  });
  assert.equal(overview.sessions.activeTotal, 1);
  assert.deepEqual(overview.sessions.active.map((session) => session.id), ["visible-running"]);
  assert.equal(overview.sessions.recentTotal, 1);
  assert.deepEqual(overview.sessions.recent.map((session) => session.id), ["visible-complete"]);
  assert.equal(overview.sessions.totalNonGenerated, 2);
});

test("Overview falls back to the next active task when no running session exists", () => {
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [
      modelTask(1, {
        id: "task-1",
        title: "Investigate queue drift",
        updatedAt: "2026-08-07T19:57:30.000Z",
        nextStep: {
          summary: "Open the queue drift trace",
          requiresApproval: false,
          origin: "human",
          updatedAt: "2026-08-07T19:57:00.000Z",
        },
      }),
    ],
    sessions: [
      modelSession(1, {
        id: "chat-1",
        status: "working",
        title: "Processing backlog",
        updated_at: "2026-08-07T19:59:00.000Z",
      }),
    ],
    reminders: [],
    healRequests: [],
    now: NOW,
  });

  assert.deepEqual(overview.now, {
    kind: "task",
    id: "task-1",
    title: "Investigate queue drift",
    nextStep: "Open the queue drift trace",
    updatedAt: "2026-08-07T19:57:30.000Z",
  });
  assert.equal(overview.sessions.activeTotal, 1);
});

test("Overview falls back to idle when no running session or active task exists", () => {
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [modelTask(1, { id: "task-1", title: "Triage notes", nextStep: null })],
    sessions: [
      modelSession(1, {
        id: "chat-1",
        status: "waiting",
        title: "Await approval",
        updated_at: "2026-08-07T19:59:00.000Z",
      }),
    ],
    reminders: [],
    healRequests: [],
    now: NOW,
  });

  assert.deepEqual(overview.now, { kind: "idle", label: "No active work" });
  assert.equal(overview.sessions.activeTotal, 1);
});

test("blocked task rows preserve dependencies, primary blocker, and next step", () => {
  const dependency = {
    id: "dep-1",
    kind: "human",
    label: "Approve production access",
    state: "unresolved",
    origin: "human",
    createdAt: "2026-08-07T18:00:00.000Z",
  };
  const nextStep = {
    summary: "Request production access approval",
    requiresApproval: true,
    origin: "human",
    updatedAt: "2026-08-07T18:01:00.000Z",
  };
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [modelTask(1, {
      id: "task-1",
      title: "Deploy service",
      status: "blocked",
      priority: "urgent",
      dependencies: [dependency],
      primaryBlockerId: "dep-1",
      nextStep,
      updatedAt: "2026-08-07T18:02:00.000Z",
    })],
    sessions: [],
    reminders: [],
    healRequests: [],
    now: NOW,
  });

  assert.deepEqual(overview.tasks.items[0].dependencies, [dependency]);
  assert.deepEqual(overview.tasks.items[0].primaryBlocker, dependency);
  assert.deepEqual(overview.tasks.items[0].nextStep, nextStep);
});

test("blocked task rows cap dependency previews without losing the primary blocker", () => {
  const dependencies = Array.from(
    { length: TASK_DEPENDENCY_LIMIT + 2 },
    (_, index) => ({
      id: `dep-${index}`,
      kind: "task",
      label: `Dependency ${index}`,
      taskId: `task-${index}`,
      state: "unresolved",
      origin: "human",
      createdAt: `2026-08-07T18:${String(index).padStart(2, "0")}:00.000Z`,
    }),
  );
  const primaryBlocker = dependencies.at(-1)!;
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [modelTask(1, {
      id: "task-1",
      title: "Deploy service",
      status: "blocked",
      priority: "urgent",
      dependencies,
      primaryBlockerId: primaryBlocker.id,
    })],
    sessions: [],
    reminders: [],
    healRequests: [],
    now: NOW,
  });

  assert.equal(
    overview.tasks.items[0].dependencies.length,
    TASK_DEPENDENCY_LIMIT,
  );
  assert.deepEqual(
    overview.tasks.items[0].dependencies.map((dependency) => dependency.id),
    dependencies
      .slice(0, TASK_DEPENDENCY_LIMIT)
      .map((dependency) => dependency.id),
  );
  assert.deepEqual(overview.tasks.items[0].primaryBlocker, primaryBlocker);
});

test("Overview bounds lists while retaining totals and scopes reminders", () => {
  const tasks = Array.from({ length: 8 }, (_, index) => modelTask(index, {
    title: `Task ${index}`,
    status: "inbox",
    priority: "medium",
    updatedAt: `2026-08-07T1${index}:00:00.000Z`,
  }));
  const reminders = Array.from({ length: 8 }, (_, index) => modelReminder(index, {
    familiarId: index === 7 ? "moss" : "sage",
    title: `Reminder ${index}`,
    status: index < 2 ? "fired" : "pending",
    updatedAt: `2026-08-07T1${index}:00:00.000Z`,
  }));
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks,
    sessions: [],
    reminders,
    healRequests: [],
    now: NOW,
  });

  assert.equal(overview.tasks.total, 8);
  assert.equal(overview.tasks.items.length, 6);
  assert.equal(overview.reminders.total, 7);
  assert.equal(overview.reminders.items.length, 5);
  assert.equal(overview.reminders.items.some((item) => item.familiarId === "moss"), false);
  assert.ok(overview.attention.items.every((item) => item.source !== ""));
});

test("Overview keeps a critical heal item represented ahead of newer warning attention", () => {
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: Array.from({ length: 5 }, (_, index) => modelTask(index, {
      id: `review-${index}`,
      title: `Review ${index}`,
      status: "review",
      priority: "medium",
      updatedAt: `2026-08-07T19:5${index}:00.000Z`,
    })),
    sessions: [],
    reminders: [
      modelReminder(0, {
        id: "fired-0",
        title: "Reminder 0",
        status: "fired",
        updatedAt: "2026-08-07T19:59:30.000Z",
      }),
    ],
    healRequests: [{
      id: "sage:contract:0:SOUL.md:purpose",
      familiarId: "sage",
      source: "contract",
      severity: "crit",
      title: "SOUL.md contract violation",
      detail: "Purpose is missing.",
      suggestedAction: "Fix purpose in SOUL.md.",
      actionKind: "fix-contract",
      createdAt: "2026-08-07T19:59:45.000Z",
      resolved: false,
    }],
    now: NOW,
  });

  assert.equal(overview.attention.total, 7);
  assert.equal(overview.attention.items.length, 6);
  assert.equal(overview.attention.items[0].id, "heal:sage:contract:0:SOUL.md:purpose");
  assert.equal(overview.attention.items[0].updatedAt, "2026-08-07T19:59:45.000Z");
  assert.equal(
    overview.attention.items.some((item) => item.id === "heal:sage:contract:0:SOUL.md:purpose"),
    true,
  );
});

test("section state is deterministic and server builders never emit stale", () => {
  const generatedAt = "2026-08-07T20:00:00.000Z";
  const success = { ok: true, data: [] };
  const failure = { ok: false, source: "sessions", code: "sessions_unavailable" };

  assert.equal(buildDashboardSection({
    generatedAt,
    required: [success],
    optional: [],
    data: { rows: [1] },
    empty: false,
  }).state, "fresh");
  assert.equal(buildDashboardSection({
    generatedAt,
    required: [success],
    optional: [],
    data: { rows: [] },
    empty: true,
  }).state, "empty");
  assert.equal(buildDashboardSection({
    generatedAt,
    required: [success, failure],
    optional: [],
    data: { rows: [1] },
    empty: false,
  }).state, "partial");
  assert.equal(buildDashboardSection({
    generatedAt,
    required: [failure],
    optional: [],
    data: null,
    empty: false,
  }).state, "unavailable");
});

test("Analytics publishes bands and samples without a composite score", () => {
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [],
    reportTotal: 0,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: NOW,
  });

  assert.equal(analytics.activity.pulse.length, 14);
  assert.equal(analytics.confidence.band, null);
  assert.equal(analytics.confidence.sampleCount, 0);
  assert.equal(analytics.confidence.insufficientData, true);
  assert.equal("score" in analytics.confidence, false);
  assert.equal("overallScore" in analytics, false);
  assert.equal(analytics.memory.count, 0);
  assert.equal(analytics.memory.availability, "ready");
});

test("analytics emptiness tracks all user-visible signals", () => {
  const emptyAnalytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [],
    reportTotal: 0,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: NOW,
  });
  const healAnalytics = {
    ...emptyAnalytics,
    healRequests: [{
      id: "heal-1",
      severity: "warn",
      title: "Follow up",
      detail: "Needs attention.",
      suggestedAction: "Check it.",
      actionKind: "manual",
    }],
  };
  const feedbackAnalytics = {
    ...emptyAnalytics,
    feedback: {
      ...emptyAnalytics.feedback,
      up: 1,
      total: 1,
      models: [{
        key: "claude-sonnet",
        up: 1,
        down: 0,
        total: 1,
        approval: 1,
      }],
    },
  };

  assert.equal(isFamiliarAnalyticsDigestEmpty(emptyAnalytics), true);
  assert.equal(isFamiliarAnalyticsDigestEmpty(healAnalytics), false);
  assert.equal(isFamiliarAnalyticsDigestEmpty(feedbackAnalytics), false);
});

test("Analytics excludes archived sessions from totals, evidence, and pulse", () => {
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [
      modelSession(1, {
        id: "archived-latest",
        status: "running",
        updated_at: "2026-08-07T19:59:30.000Z",
        archived_at: "2026-08-07T20:00:00.000Z",
      }),
      modelSession(2, {
        id: "visible-latest",
        status: "running",
        updated_at: "2026-08-07T19:59:00.000Z",
      }),
      modelSession(3, {
        id: "visible-earlier",
        status: "completed",
        updated_at: "2026-08-06T19:58:00.000Z",
      }),
    ],
    reports: [],
    reportTotal: 0,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: NOW,
  });

  assert.equal(analytics.activity.sampleCount, 2);
  assert.equal(analytics.activity.evidenceCount, 2);
  assert.equal(analytics.activity.totalSessions, 2);
  assert.equal(analytics.activity.freshness, "2026-08-07T19:59:00.000Z");
  assert.equal(analytics.activity.lastActiveAt, "2026-08-07T19:59:00.000Z");
  assert.equal(
    analytics.activity.pulse.reduce((sum, day) => sum + day.count, 0),
    2,
  );
  assert.equal(
    analytics.activity.pulse.find((day) => day.key === "2026-08-07")?.count,
    1,
  );
  assert.equal(
    analytics.activity.pulse.find((day) => day.key === "2026-08-06")?.count,
    1,
  );
});

test("serializedDashboardBytes counts UTF-8 bytes", () => {
  assert.equal(serializedDashboardBytes({ value: "🧙" }), Buffer.byteLength('{"value":"🧙"}'));
});

function modelTask(
  index: number,
  overrides: Record<string, unknown> = {},
) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `task-${index}`,
    title: `Task ${index}`,
    notes: "",
    status: "inbox",
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
    lifecycle: "queued",
    lifecycleAt: updatedAt,
    retryCount: 0,
    maxRetries: 2,
    steps: [],
    dependencies: [],
    primaryBlockerId: null,
    nextStep: null,
    ...overrides,
  };
}

function modelReminder(
  index: number,
  overrides: Record<string, unknown> = {},
) {
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
    ...overrides,
  };
}

function modelSession(
  index: number,
  overrides: Record<string, unknown> = {},
) {
  const minute = String(index % 60).padStart(2, "0");
  return {
    id: `session-${index}`,
    project_root: "/repo",
    harness: "claude",
    model: "claude-sonnet",
    runtime: "local",
    title: `Session ${index}`,
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: `2026-08-07T18:${minute}:00.000Z`,
    updated_at: `2026-08-07T19:${minute}:00.000Z`,
    familiarId: "sage",
    origin: "chat",
    generated: false,
    ...overrides,
  };
}

function modelReport(
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
    capabilitiesLacking: [{
      name: "browser",
      importance: "important",
      detail: "Browser access was unavailable.",
    }],
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

function modelSnapshot(
  index: number,
  reportedAt: string,
) {
  return {
    id: `snapshot-${index}`,
    sessionId: `session-${index}`,
    reportedAt,
    confidence: 70,
    toolReliability: 80,
    memoryRecall: 60,
    fileLocatability: 90,
    contextPressure: "adequate",
  };
}

test("Overview caps active and recent sessions while retaining totals", () => {
  const sessions = [
    ...Array.from({ length: 4 }, (_, index) =>
      modelSession(index, { status: index === 0 ? "running" : "working" }),
    ),
    ...Array.from({ length: 6 }, (_, index) =>
      modelSession(index + 10, { status: "completed" }),
    ),
    modelSession(99, { generated: true, status: "running" }),
  ];
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [],
    sessions,
    reminders: [],
    healRequests: [],
    now: NOW,
  });
  assert.equal(overview.sessions.active.length, 3);
  assert.equal(overview.sessions.activeTotal, 4);
  assert.equal(overview.sessions.recent.length, 5);
  assert.equal(overview.sessions.recentTotal, 6);
  assert.equal(overview.sessions.totalNonGenerated, 10);
});

test("Analytics bounds evidence, reports, and the trailing metric window", () => {
  const sessions = Array.from({ length: 130 }, (_, index) =>
    modelSession(index),
  );
  const reports = Array.from({ length: 40 }, (_, index) =>
    modelReport(index),
  );
  const snapshots = [
    ...Array.from({ length: 120 }, (_, index) =>
      modelSnapshot(index, new Date(NOW - index * 60_000).toISOString()),
    ),
    modelSnapshot(999, new Date(NOW - 31 * 24 * 60 * 60_000).toISOString()),
  ];
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions,
    reports,
    reportTotal: 1,
    snapshots,
    snapshotTotal: 2,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 4, down: 2, total: 6, models: [], runtimes: [] },
    now: NOW,
  });
  assert.equal(analytics.activity.evidenceCount, 100);
  assert.equal(analytics.confidence.sampleCount, 30);
  assert.equal(analytics.confidence.latestReportAt, reports[0].reportedAt);
  assert.equal(analytics.trends.sampleCount, 100);
  assert.equal(analytics.trends.period, "last 30 days");
  assert.equal(analytics.feedback.state, "stable");
});

test("Analytics trends derive only from the bounded 100 newest in-window snapshots", () => {
  const snapshots = [
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `kept-${index}`,
      sessionId: `session-${index}`,
      reportedAt: new Date(NOW - index * 60_000).toISOString(),
      confidence: 100,
      toolReliability: 80,
      memoryRecall: 60,
      fileLocatability: 90,
      contextPressure: "adequate",
    })),
    {
      id: "dropped-oldest-in-window",
      sessionId: "session-oldest-in-window",
      reportedAt: new Date(NOW - 100 * 60_000).toISOString(),
      confidence: 0,
      toolReliability: 0,
      memoryRecall: 0,
      fileLocatability: 0,
      contextPressure: "adequate",
    },
    {
      id: "outside-window",
      sessionId: "session-outside-window",
      reportedAt: new Date(NOW - 31 * 24 * 60 * 60_000).toISOString(),
      confidence: 0,
      toolReliability: 0,
      memoryRecall: 0,
      fileLocatability: 0,
      contextPressure: "adequate",
    },
  ];
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [],
    reportTotal: 0,
    snapshots,
    snapshotTotal: snapshots.length,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: NOW,
  });

  assert.equal(analytics.trends.period, "last 30 days");
  assert.equal(analytics.trends.sampleCount, 100);
  assert.equal(
    analytics.trends.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    100,
  );
  assert.equal(
    analytics.trends.metrics.find((metric) => metric.key === "confidence")?.latest,
    100,
  );
});

test("Analytics pulse counts every in-window day even when evidence rows cap at 100", () => {
  const sessions = Array.from({ length: 14 * 10 }, (_, index) => {
    const dayOffset = Math.floor(index / 10);
    const sessionIndex = index % 10;
    const updatedAt = new Date(
      NOW - dayOffset * 24 * 60 * 60_000 - sessionIndex * 60_000,
    ).toISOString();
    return modelSession(index, {
      id: `pulse-${dayOffset}-${sessionIndex}`,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
  });
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions,
    reports: [],
    reportTotal: 0,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: NOW,
  });

  assert.equal(analytics.activity.sampleCount, 100);
  assert.equal(analytics.activity.evidenceCount, 100);
  assert.equal(analytics.activity.totalSessions, 140);
  assert.equal(analytics.activity.pulse.length, 14);
  assert.equal(
    analytics.activity.pulse.reduce((sum, day) => sum + day.count, 0),
    140,
  );
  assert.ok(analytics.activity.pulse.every((day) => day.count === 10));
});

test("Analytics activity pulse buckets by UTC day across midnight and the 14-day boundary", () => {
  const boundaryNow = Date.parse("2026-08-07T00:30:00.000Z");
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [
      modelSession(1, {
        id: "window-start",
        updated_at: "2026-07-25T00:00:00.000Z",
      }),
      modelSession(2, {
        id: "before-window",
        updated_at: "2026-07-24T23:59:59.999Z",
      }),
      modelSession(3, {
        id: "before-midnight",
        updated_at: "2026-08-05T23:59:59.999Z",
      }),
      modelSession(4, {
        id: "after-midnight",
        updated_at: "2026-08-06T00:00:00.000Z",
      }),
    ],
    reports: [],
    reportTotal: 0,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: boundaryNow,
  });

  const pulseCounts = new Map(
    analytics.activity.pulse.map((day) => [day.key, day.count]),
  );
  assert.equal(analytics.activity.pulse.length, 14);
  assert.equal(analytics.activity.pulse[0]?.key, "2026-07-25");
  assert.equal(analytics.activity.pulse.at(-1)?.key, "2026-08-07");
  assert.equal(
    analytics.activity.pulse.reduce((sum, day) => sum + day.count, 0),
    3,
  );
  assert.equal(pulseCounts.get("2026-07-25"), 1);
  assert.equal(pulseCounts.get("2026-08-05"), 1);
  assert.equal(pulseCounts.get("2026-08-06"), 1);
  assert.equal(pulseCounts.has("2026-07-24"), false);
});

test("Analytics distinguishes unavailable memory from ready-empty memory", () => {
  const input = {
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [],
    reportTotal: 0,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: NOW,
  };
  const unavailable = buildFamiliarAnalyticsDigest({
    ...input,
    memoryAvailability: "unavailable",
  });
  const ready = buildFamiliarAnalyticsDigest({
    ...input,
    memoryAvailability: "ready",
  });
  assert.deepEqual(
    { availability: unavailable.memory.availability, count: unavailable.memory.count },
    { availability: "unavailable", count: null },
  );
  assert.deepEqual(
    { availability: ready.memory.availability, count: ready.memory.count },
    { availability: "ready", count: 0 },
  );
});

test("Analytics exposes used, lacking, vital, heal, and regression evidence", () => {
  const report = modelReport(0);
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [report],
    reportTotal: 1,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: {
      specVersion: "0.1.0",
      pass: false,
      properties: [{
        property: "Defined Purpose",
        pass: false,
      }],
      violations: [{
        file: "SOUL.md",
        field: "purpose",
        message: "Purpose is missing.",
      }],
      warnings: [],
    },
    feedback: { up: 2, down: 3, total: 5, models: [], runtimes: [] },
    now: NOW,
  });
  assert.deepEqual(analytics.capabilities.used, [{
    name: "web-search",
    count: 1,
  }]);
  assert.equal(analytics.capabilities.lacking[0].name, "browser");
  assert.equal(analytics.capabilities.vital[0].name, "shell");
  assert.equal(analytics.healRequests.length, 1);
  assert.equal(analytics.feedback.state, "regressing");
});

test("Analytics caps capabilities and heal requests deterministically", () => {
  const lacking = [
    { name: "zeta", importance: "nice-to-have", detail: "Need zeta." },
    { name: "beta", importance: "blocking", detail: "Need beta." },
    { name: "alpha", importance: "blocking", detail: "Need alpha." },
    { name: "eta", importance: "important", detail: "Need eta." },
    { name: "delta", importance: "important", detail: "Need delta." },
    { name: "gamma", importance: "important", detail: "Need gamma." },
    ...Array.from({ length: 12 }, (_, index) => ({
      name: `extra-${String(index).padStart(2, "0")}`,
      importance: index % 2 === 0 ? "important" : "nice-to-have",
      detail: `Need extra ${index}.`,
    })),
  ];
  const vital = [
    { name: "shell", currentState: "available" },
    { name: "browser", currentState: "missing" },
    { name: "docs", currentState: "degraded" },
    { name: "agent", currentState: "missing" },
    ...Array.from({ length: 12 }, (_, index) => ({
      name: `vital-${String(index).padStart(2, "0")}`,
      currentState: index % 3 === 0 ? "missing" : index % 3 === 1 ? "degraded" : "available",
      notes: `State ${index}`,
    })),
  ];
  const healRequests = Array.from({ length: 10 }, (_, index) => ({
    id: `heal-${index}`,
    familiarId: "sage",
    source: "self-report-aggregate",
    severity: index < 3 ? "warn" : index < 6 ? "crit" : "info",
    title: `Heal ${index}`,
    detail: `Detail ${index}`,
    suggestedAction: `Action ${index}`,
    actionKind: "manual",
    createdAt: new Date(NOW - index * 60_000).toISOString(),
    resolved: false,
  }));
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [
      modelReport(0, {
        skillsUsed: ["zeta", "delta", "eta", "epsilon", "beta", "alpha"],
        capabilitiesLacking: lacking,
        capabilitiesVital: vital,
      }),
      modelReport(1, {
        skillsUsed: ["alpha", "beta", "gamma", "omega"],
        capabilitiesLacking: lacking,
        capabilitiesVital: vital,
      }),
      modelReport(2, {
        skillsUsed: ["alpha", "beta", "gamma"],
        capabilitiesLacking: lacking,
        capabilitiesVital: vital,
      }),
    ],
    reportTotal: 3,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    healRequests,
    now: NOW,
  });

  assert.deepEqual(analytics.capabilities.used, [
    { name: "alpha", count: 3 },
    { name: "beta", count: 3 },
    { name: "gamma", count: 2 },
    { name: "delta", count: 1 },
    { name: "epsilon", count: 1 },
  ]);
  assert.equal(
    analytics.capabilities.lacking.length,
    CAPABILITY_LACKING_LIMIT,
  );
  assert.deepEqual(
    analytics.capabilities.lacking.slice(0, 5).map((capability) => capability.name),
    ["alpha", "beta", "delta", "eta", "extra-00"],
  );
  assert.equal(
    analytics.capabilities.vital.length,
    CAPABILITY_VITAL_LIMIT,
  );
  assert.deepEqual(
    analytics.capabilities.vital.slice(0, 5).map((capability) => capability.name),
    ["agent", "browser", "vital-00", "vital-03", "vital-06"],
  );
  assert.equal(analytics.healRequests.length, HEAL_REQUEST_LIMIT);
  assert.deepEqual(
    analytics.healRequests.slice(0, 5).map((request) => request.id),
    ["heal-3", "heal-4", "heal-5", "heal-0", "heal-1"],
  );
});

test("Profile projects every approved identity and access field", () => {
  const profile = buildFamiliarProfile({
    familiar: {
      id: "sage",
      display_name: "Sage",
      role: "Researcher",
      description: "Finds evidence.",
      pronouns: "they/them",
      icon: "ph:book-open-fill",
      emoji: "📚",
      color: "violet",
      familiarType: "researcher",
      status: "online",
      memory_freshness: "2026-08-07T19:00:00.000Z",
      harness: "codex",
      defaultHarness: "claude",
      harnessOverride: "codex",
      model: "gpt-5.3-codex",
      voiceProvider: "elevenlabs",
      voiceModel: "multilingual-v2",
      voiceName: "Sage",
      imageProvider: "openai",
      imageModel: "gpt-image-2",
      imageSize: "1024x1024",
      imageQuality: "high",
      note: "Prefer primary sources.",
      autoSelfReport: true,
      asanaEnabled: false,
      asanaWorkspaceGid: "workspace-1",
      xResearchEnabled: true,
      xPublishEnabled: false,
      omnigent: {
        agentId: "agent-1",
        hostId: "host-1",
        workspace: "/work/sage",
      },
    },
    config: {
      defaults: { harness: "claude", model: "claude-sonnet" },
      familiars: { sage: { model: "gpt-5.3-codex", asanaEnabled: false } },
    },
    files: {
      soul: "# Sage\n\n## Purpose\nFind and verify primary evidence.",
      identity: null,
      ward: null,
      memory: null,
    },
    contractReport: {
      specVersion: "0.1.0",
      pass: true,
      properties: [{
        property: "Defined Purpose",
        pass: true,
      }],
      violations: [],
      warnings: [],
    },
    projects: [{
      project: { id: "cave", name: "Coven Cave", root: "/repo" },
      access: "write",
    }],
  });
  assert.equal(profile.description, "Finds evidence.");
  assert.equal(profile.purpose, "Find and verify primary evidence.");
  assert.deepEqual(profile.glyph, {
    icon: "ph:book-open-fill",
    emoji: "📚",
    color: "violet",
  });
  assert.equal(profile.runtime.modelProvenance, "familiar");
  assert.equal(profile.memoryFreshness, "2026-08-07T19:00:00.000Z");
  assert.equal(profile.voice.name, "Sage");
  assert.equal(profile.image.model, "gpt-image-2");
  assert.equal(profile.configuration.autoSelfReport, true);
  assert.equal(profile.configuration.omnigent.agentId, "agent-1");
  assert.equal(profile.contract.propertyPassed, 1);
  assert.deepEqual(profile.access.projects.items, [{
    id: "cave",
    name: "Coven Cave",
    access: "write",
  }]);
  assert.deepEqual(
    profile.access.tools.map((tool) => [tool.id, tool.enabled]),
    [["asana", false], ["x-research", true], ["x-publish", false]],
  );
});

test("Profile caps project access rows deterministically while preserving total", () => {
  const projects = [
    {
      project: { id: "alpha-b", name: "Alpha", root: "/repo/alpha-b" },
      access: "write" as const,
    },
    {
      project: { id: "alpha-a", name: "Alpha", root: "/repo/alpha-a" },
      access: "read" as const,
    },
    ...Array.from({ length: 55 }, (_, index) => ({
      project: {
        id: `project-${String(55 - index).padStart(2, "0")}`,
        name: `Project ${String(55 - index).padStart(2, "0")}`,
        root: `/repo/${index}`,
      },
      access: "write" as const,
    })),
  ];
  const profile = buildFamiliarProfile({
    familiar: {
      id: "sage",
      display_name: "Sage",
      role: "Researcher",
      harness: "claude",
      defaultHarness: "claude",
      harnessOverride: null,
      model: "claude-sonnet",
    },
    config: {
      defaults: { harness: "claude", model: "claude-sonnet" },
      familiars: { sage: {} },
    },
    files: { soul: null, identity: null, ward: null, memory: null },
    contractReport: null,
    projects,
  });

  assert.equal(profile.access.projects.total, 57);
  assert.equal(
    profile.access.projects.items.length,
    ACCESS_PROJECT_LIMIT,
  );
  assert.deepEqual(profile.access.projects.items.slice(0, 2), [
    { id: "alpha-a", name: "Alpha", access: "read" },
    { id: "alpha-b", name: "Alpha", access: "write" },
  ]);
  assert.deepEqual(
    profile.access.projects.items.at(-1),
    { id: "project-48", name: "Project 48", access: "write" },
  );
});

test("Profile preserves inherited Coven default model provenance", () => {
  const profile = buildFamiliarProfile({
    familiar: {
      id: "sage",
      display_name: "Sage",
      role: "Researcher",
      harness: "claude",
      defaultHarness: "claude",
      harnessOverride: null,
      model: "claude-sonnet",
    },
    config: {
      defaults: { harness: "claude", model: "claude-sonnet" },
      familiars: { sage: {} },
    },
    files: { soul: null, identity: null, ward: null, memory: null },
    contractReport: null,
    projects: [],
  });

  assert.equal(profile.runtime.modelProvenance, "coven_default");
});

test("Profile reports runtime-owned empty bindings as unconfigured even with a Cave default model", () => {
  const profile = buildFamiliarProfile({
    familiar: {
      id: "sage",
      display_name: "Sage",
      role: "Researcher",
      harness: "grok",
      defaultHarness: "claude",
      harnessOverride: "grok",
      model: "",
    },
    config: {
      defaults: { harness: "claude", model: "claude-sonnet" },
      familiars: { sage: { harness: "grok" } },
    },
    files: { soul: null, identity: null, ward: null, memory: null },
    contractReport: null,
    projects: [],
  });

  assert.equal(profile.runtime.modelProvenance, "unconfigured");
});
