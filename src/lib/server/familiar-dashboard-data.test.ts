// @ts-nocheck
/**
 * Behaviour of the dashboard aggregate loader under real failure.
 *
 * Every test here injects dependencies that FAIL and then asserts what the
 * assembled payload claims — not that it has a `state` key, and not that some
 * string appears in it. The redaction tests in particular throw errors carrying
 * real filesystem paths and a token and then search the SERIALIZED response for
 * those exact substrings, because that is the only form of the question that a
 * "we emit a code" implementation cannot pass by accident.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadFamiliarDashboard } from "./familiar-dashboard-data.ts";
import {
  FAMILIAR_DASHBOARD_ISSUE_CODES,
  FAMILIAR_DASHBOARD_LIMITS,
  serializedDashboardBytes,
} from "../familiar-dashboard.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");

const CONFIG = {
  version: 1,
  defaults: { harness: "claude", model: "claude-sonnet" },
  familiars: {
    sage: { harness: "codex", model: "gpt-5.3", autoSelfReport: true },
  },
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

const ROSTER_OK = {
  ok: true,
  config: CONFIG,
  target: { mode: "local", label: "Local daemon", socketPath: "/tmp/coven.sock" },
  roster: [
    {
      id: "sage",
      display_name: "Sage",
      role: "Researcher",
      status: "online",
      last_seen: "2026-08-23T11:58:00.000Z",
    },
  ],
};

/** Every dependency healthy, and every source genuinely EMPTY. */
function healthyDependencies(overrides = {}) {
  return {
    loadRoster: async () => ROSTER_OK,
    loadConfig: async () => CONFIG,
    resolveAvatar: async () => null,
    loadSessions: async () => ({ sessions: [], degraded: false }),
    loadTasks: async () => [],
    loadReminders: async () => [],
    loadMemory: async () => [],
    loadContract: async () => ({ properties: [], violations: [], warnings: [] }),
    loadSelfReports: async () => ({ reports: [], total: 0 }),
    ...overrides,
  };
}

async function load(overrides = {}) {
  return loadFamiliarDashboard({
    familiarId: "sage",
    dependencies: healthyDependencies(overrides),
    now: NOW,
  });
}

function allIssues(response) {
  return Object.values(response.sections).flatMap((section) => section.issues);
}

// --- existence vs unavailability -------------------------------------------

test("an unreadable roster is `unavailable`, never `not_found`", async () => {
  const daemonDown = await loadFamiliarDashboard({
    familiarId: "sage",
    dependencies: healthyDependencies({
      loadRoster: async () => ({
        ok: false,
        config: CONFIG,
        target: {},
        status: 503,
        error: "connect ENOENT /Users/buns/.coven/daemon.sock",
      }),
    }),
    now: NOW,
  });
  assert.equal(
    daemonDown.outcome,
    "unavailable",
    "a daemon outage must not be reported as a deleted familiar",
  );

  const threw = await loadFamiliarDashboard({
    familiarId: "sage",
    dependencies: healthyDependencies({
      loadRoster: async () => {
        throw new Error("roster exploded");
      },
    }),
    now: NOW,
  });
  assert.equal(threw.outcome, "unavailable");
});

test("a well-formed id that names no familiar is `not_found`", async () => {
  const result = await loadFamiliarDashboard({
    familiarId: "nobody",
    dependencies: healthyDependencies(),
    now: NOW,
  });
  assert.equal(result.outcome, "not_found");
});

// --- failure isolation ------------------------------------------------------

test("one failing source degrades only its own section; the read still succeeds", async () => {
  const result = await load({
    loadSessions: async () => {
      throw new Error("daemon unreachable");
    },
  });

  assert.equal(result.outcome, "ok", "a failed source must not fail the whole read");
  const { sections } = result.response;

  assert.equal(sections.overview.state, "partial");
  assert.ok(
    sections.overview.issues.some((issue) => issue.code === "sessions_unavailable"),
    "the overview names the source that failed",
  );
  assert.notEqual(
    sections.overview.state,
    "empty",
    "a section whose source failed must never present as an honest empty",
  );
  assert.deepEqual(
    sections.overview.data.now,
    { kind: "unknown" },
    "with sessions unreadable the hub must not claim the familiar is idle",
  );

  // Isolation: profile never consulted sessions, so it is untouched.
  assert.equal(sections.profile.issues.length, 0);
  assert.notEqual(sections.profile.data, null);
});

test("every source failing still yields a truthful 200-shaped payload", async () => {
  const boom = () => {
    throw new Error("nope");
  };
  const result = await load({
    loadConfig: async () => boom(),
    loadSessions: async () => boom(),
    loadMemory: async () => boom(),
    loadContract: async () => boom(),
    loadSelfReports: async () => boom(),
  });

  assert.equal(result.outcome, "ok");
  const { sections, identity } = result.response;

  // Identity survives on the roster entry alone.
  assert.equal(identity.displayName, "Sage");

  // Analytics REQUIRES self-reports, so it is unavailable — with a reason.
  assert.equal(sections.analytics.state, "unavailable");
  assert.equal(sections.analytics.data, null);
  assert.ok(
    sections.analytics.issues.some((issue) => issue.code === "self_reports_unavailable"),
    "an unavailable section must always say why",
  );

  // The survivable sections degrade rather than vanish.
  assert.equal(sections.overview.state, "partial");
  assert.equal(sections.profile.state, "partial");
  for (const name of ["overview", "profile"]) {
    assert.notEqual(sections[name].data, null, `${name} kept renderable data`);
    assert.ok(sections[name].issues.length > 0, `${name} declared its degradation`);
  }
});

test("a degraded (daemon-down, local-only) session list is not reported as fresh", async () => {
  const result = await load({
    loadSessions: async () => ({
      sessions: [
        {
          id: "s1",
          title: "Local chat",
          status: "completed",
          updated_at: "2026-08-23T11:00:00.000Z",
        },
      ],
      degraded: true,
    }),
  });

  const { overview } = result.response.sections;
  assert.equal(overview.state, "partial");
  assert.ok(overview.issues.some((issue) => issue.code === "sessions_degraded"));
  assert.notEqual(
    overview.state,
    "fresh",
    "a known-incomplete list must not claim to be the whole truth",
  );
});

// --- the positive `empty` ---------------------------------------------------

test("healthy sources with nothing in them produce `empty` and ZERO issues", async () => {
  const result = await load({
    loadRoster: async () => ({
      ...ROSTER_OK,
      roster: ROSTER_OK.roster.map((familiar) => ({ ...familiar, status: null })),
    }),
    loadConfig: async () => ({
      ...CONFIG,
      defaults: { harness: null, model: null },
      familiars: { sage: {} },
    }),
  });
  assert.equal(result.outcome, "ok");

  const { overview, analytics } = result.response.sections;
  assert.equal(overview.state, "empty");
  assert.deepEqual(overview.issues, [], "a positive empty carries no issues");
  assert.notEqual(overview.data, null, "an empty section still carries readable data");
  assert.deepEqual(
    overview.data.now,
    { kind: "idle" },
    "with sessions readable and nothing running, idle is a claim we can make",
  );

  assert.equal(analytics.state, "empty");
  assert.deepEqual(analytics.issues, []);
  assert.equal(analytics.data.sampleSize, 0);
});

// --- redaction --------------------------------------------------------------

test("no raw error text, path, or secret from a failing source reaches the payload", async () => {
  const SECRET = "sk-live-4a9f2b7c1d8e";
  const PATH = "/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.coven/familiars/sage";
  const WINPATH = "C:\\Users\\timot\\.coven\\secrets.json";

  const result = await load({
    loadSessions: async () => {
      throw new Error(`connect ENOENT ${PATH}/daemon.sock token=${SECRET}`);
    },
    loadMemory: async () => {
      const error = new Error(`EACCES: permission denied, open '${WINPATH}'`);
      error.cause = { authorization: `Bearer ${SECRET}` };
      throw error;
    },
    loadContract: async () => {
      throw new Error(`ENOENT ${PATH}/SOUL.md`);
    },
    loadSelfReports: async () => {
      throw new Error(`path not allowed: ${PATH}/self-reports`);
    },
  });

  assert.equal(result.outcome, "ok");
  const serialized = JSON.stringify(result.response);

  for (const leak of [SECRET, PATH, WINPATH, "ENOENT", "EACCES", "Bearer", "daemon.sock"]) {
    assert.equal(
      serialized.includes(leak),
      false,
      `the response leaked ${JSON.stringify(leak)} from a source error`,
    );
  }

  // And the issues that DID surface are all closed-registry literals.
  const issues = allIssues(result.response);
  assert.ok(issues.length > 0, "the failures must still be reported at all");
  for (const issue of issues) {
    assert.ok(
      FAMILIAR_DASHBOARD_ISSUE_CODES.includes(issue.code),
      `${issue.code} is not in the published issue-code registry`,
    );
    assert.equal(typeof issue.retryable, "boolean", "a client needs to know whether to retry");
  }
});

test("a secret embedded in successfully-loaded source DATA is redacted", async () => {
  const SECRET = "sk-live-9f3c7a2e4b8d1c6f0a5e";
  const result = await load({
    loadSessions: async () => ({
      sessions: [
        {
          id: "s1",
          title: `Deploy with token ${SECRET}`,
          status: "running",
          updated_at: "2026-08-23T11:00:00.000Z",
        },
      ],
      degraded: false,
    }),
  });

  const serialized = JSON.stringify(result.response);
  assert.equal(
    serialized.includes(SECRET),
    false,
    "a secret a familiar typed into a session title must not be relayed verbatim",
  );
  assert.equal(
    result.response.sections.overview.data.sessions.active.total,
    1,
    "redaction must not drop the row it cleaned",
  );
});

// --- bounds -----------------------------------------------------------------

test("an enormous source is bounded and the response stays under 128 KiB", async () => {
  const result = await load({
    loadSessions: async () => ({
      sessions: Array.from({ length: 10_000 }, (_, index) => ({
        id: `session-${index}`,
        title: "T".repeat(5_000),
        status: index % 2 === 0 ? "running" : "completed",
        updated_at: `2026-08-2${index % 3}T10:00:00.000Z`,
      })),
      degraded: false,
    }),
    loadMemory: async () =>
      Array.from({ length: 5_000 }, (_, index) => ({
        id: `m${index}`,
        familiarId: "sage",
        title: "M".repeat(5_000),
        updatedAt: "2026-08-23T09:00:00.000Z",
        relativeUpdatedAt: "3h",
        excerpt: "E".repeat(5_000),
        source: "note",
        privacy: { classification: null, revealRequired: null },
        verification: { state: "verified" },
      })),
    loadSelfReports: async () => ({
      reports: Array.from({ length: 500 }, (_, index) => ({
        id: `r${index}`,
        familiarId: "sage",
        sessionId: `s${index}`,
        reportedAt: "2026-08-22T10:00:00.000Z",
        overallConfidence: 0.8,
        toolReliability: { score: 0.9, failedTools: [], unreliableTools: [] },
        memoryRecallScore: 0.7,
        fileLocatabilityScore: 0.6,
      })),
      total: 500,
    }),
  });

  assert.equal(result.outcome, "ok");
  const bytes = serializedDashboardBytes(result.response);
  assert.ok(
    bytes <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
    `10k sessions produced ${bytes} bytes, over the ${FAMILIAR_DASHBOARD_LIMITS.responseBytes} budget`,
  );

  const { overview, analytics } = result.response.sections;
  assert.equal(
    overview.data.sessions.active.items.length,
    FAMILIAR_DASHBOARD_LIMITS.activeSessions,
    "the active list is capped",
  );
  assert.equal(
    overview.data.sessions.active.total,
    5_000,
    "the cap reports the true total rather than hiding it",
  );
  assert.equal(
    overview.data.memory.entries.total,
    5_000,
    "memory reports its true total too",
  );
  assert.ok(
    analytics.data.sampleSize <= FAMILIAR_DASHBOARD_LIMITS.reports,
    "the analytics sample honours the report cap",
  );
  assert.equal(analytics.data.reportsTotal, 500);
});

test("memory is scoped to the requested familiar", async () => {
  const result = await load({
    loadMemory: async () => [
      {
        id: "mine",
        familiarId: "sage",
        title: "Sage note",
        updatedAt: "2026-08-23T09:00:00.000Z",
        relativeUpdatedAt: "3h",
        excerpt: "",
        source: "note",
        privacy: { classification: null, revealRequired: null },
        verification: { state: "verified" },
      },
      {
        id: "theirs",
        familiarId: "moss",
        title: "Moss note",
        updatedAt: "2026-08-23T09:30:00.000Z",
        relativeUpdatedAt: "2h",
        excerpt: "",
        source: "note",
        privacy: { classification: null, revealRequired: null },
        verification: { state: "verified" },
      },
    ],
  });

  const entries = result.response.sections.overview.data.memory.entries;
  assert.equal(entries.total, 1, "another familiar's memory must not be counted here");
  assert.equal(entries.items[0].id, "mine");
});

console.log("familiar-dashboard-data.test.ts: ok");
