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
  serializedDashboardBytes,
} from "./familiar-dashboard.ts";

const NOW = Date.parse("2026-08-07T20:00:00.000Z");

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

test("Overview prefers the newest active non-generated session for Now", () => {
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
    id: "chat-2",
    title: "Await approval",
    updatedAt: "2026-08-07T19:58:30.000Z",
  });
  assert.equal(overview.sessions.activeTotal, 2);
  assert.equal(overview.sessions.totalNonGenerated, 2);
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
