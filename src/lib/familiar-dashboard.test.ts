// @ts-nocheck
/**
 * Properties of the Familiar dashboard contract, not its spelling.
 *
 * Nothing here asserts that a field named `state` exists or that some string
 * "partial" appears somewhere in the output — a DTO can satisfy both of those
 * while lying about every section it describes. The assertions below are
 * behavioural: they drive the builders with inputs that represent real failure
 * and real overflow, and check what the resulting payload CLAIMS.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundList,
  buildDashboardSection,
  buildFamiliarAnalyticsDigest,
  buildFamiliarOverview,
  buildFamiliarProfile,
  clampDashboardText,
  classifyDashboardSectionState,
  CLIENT_DASHBOARD_SECTION_STATES,
  enforceDashboardResponseBudget,
  FAMILIAR_DASHBOARD_ISSUE_CODES,
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
  SERVER_DASHBOARD_SECTION_STATES,
  serializedDashboardBytes,
} from "./familiar-dashboard.ts";

const ISSUE = { source: "sessions", code: "sessions_unavailable", retryable: true };

test("the published version and byte budget are the ones the contract promises", () => {
  assert.equal(FAMILIAR_DASHBOARD_VERSION, 1);
  assert.equal(FAMILIAR_DASHBOARD_LIMITS.responseBytes, 128 * 1024);
});

// --- the three honesty biconditionals, over every reachable combination -----

test("section state is a total function of (requiredFailed, issues, hasContent)", () => {
  const seen = new Map();
  for (const requiredFailure of [null, ISSUE]) {
    for (const issues of [[], [ISSUE], [ISSUE, ISSUE]]) {
      for (const hasContent of [false, true]) {
        const section = buildDashboardSection({
          generatedAt: "2026-08-23T12:00:00.000Z",
          requiredFailure,
          issues,
          data: { marker: "payload" },
          hasContent,
        });
        const key = `${requiredFailure !== null}|${issues.length > 0}|${hasContent}`;

        // (1) data === null  ⟺  state === "unavailable"
        assert.equal(
          section.data === null,
          section.state === "unavailable",
          `data-null and unavailable must agree for ${key}`,
        );

        // (2) issues present  ⟺  state is partial or unavailable
        assert.equal(
          section.issues.length > 0,
          section.state === "partial" || section.state === "unavailable",
          `issue presence and degraded state must agree for ${key}`,
        );

        // (3) THE load-bearing one. A section that failed can never be `empty`.
        if (section.state === "empty") {
          assert.equal(section.issues.length, 0, `empty section carried issues for ${key}`);
          assert.notEqual(section.data, null, `empty section dropped its data for ${key}`);
        }

        // Determinism: the same inputs always produce the same state.
        const previous = seen.get(key);
        if (previous !== undefined) assert.equal(section.state, previous);
        seen.set(key, section.state);

        assert.ok(
          SERVER_DASHBOARD_SECTION_STATES.includes(section.state),
          `${section.state} is not a server-emittable state`,
        );
      }
    }
  }

  // And the specific rule that makes (3) true: an issue outranks emptiness.
  assert.equal(
    classifyDashboardSectionState({ requiredFailed: false, issues: [ISSUE], hasContent: false }),
    "partial",
    "a section that read nothing AND failed a source is partial, never empty",
  );
  assert.equal(
    classifyDashboardSectionState({ requiredFailed: false, issues: [], hasContent: false }),
    "empty",
    "a section that read nothing with every source healthy is a positive empty",
  );
});

test("no builder can emit the client-only `stale` state", () => {
  assert.ok(CLIENT_DASHBOARD_SECTION_STATES.includes("stale"));
  assert.ok(!SERVER_DASHBOARD_SECTION_STATES.includes("stale"));
  for (const requiredFailure of [null, ISSUE]) {
    for (const hasContent of [false, true]) {
      for (const issues of [[], [ISSUE]]) {
        const { state } = buildDashboardSection({
          generatedAt: "2026-08-23T12:00:00.000Z",
          requiredFailure,
          issues,
          data: {},
          hasContent,
        });
        assert.notEqual(state, "stale");
      }
    }
  }
});

test("every issue code the module publishes is a bare literal with no detail in it", () => {
  for (const code of FAMILIAR_DASHBOARD_ISSUE_CODES) {
    assert.match(code, /^[a-z][a-z0-9_]*$/, `${code} must be a bare snake_case token`);
    assert.ok(!code.includes("/") && !code.includes("\\"), `${code} must carry no path`);
  }
});

// --- "we could not read it" is distinguishable from "there is nothing" ------

test("an unreadable session source yields `unknown` now, not `idle`", () => {
  const unreadable = buildFamiliarOverview({
    sessions: [],
    memory: [],
    presence: null,
    sessionsAvailable: false,
  });
  const genuinelyIdle = buildFamiliarOverview({
    sessions: [],
    memory: [],
    presence: null,
    sessionsAvailable: true,
  });

  assert.deepEqual(unreadable.now, { kind: "unknown" });
  assert.deepEqual(genuinelyIdle.now, { kind: "idle" });
  assert.notDeepEqual(
    unreadable.now,
    genuinelyIdle.now,
    "a failed session read must not render identically to a familiar with nothing running",
  );
});

test("Now prefers a running human session over a running generated one", () => {
  const overview = buildFamiliarOverview({
    sessions: [
      {
        id: "generated",
        status: "running",
        generated: true,
        title: "Automation",
        updated_at: "2026-08-23T11:59:00.000Z",
      },
      {
        id: "chat-1",
        status: "running",
        title: "Investigate regression",
        updated_at: "2026-08-23T11:58:00.000Z",
      },
    ],
    memory: [],
    presence: null,
  });
  assert.equal(overview.now.kind, "session");
  assert.equal(overview.now.id, "chat-1");
  assert.deepEqual(
    overview.sessions.active.items.map((session) => session.id),
    ["chat-1"],
    "generated runs are not chat deep links",
  );
});

test("Overview scopes and caps work and reminders without hiding blocker context", () => {
  const tasks = Array.from({ length: 8 }, (_, index) => ({
    id: `task-${index}`,
    familiarId: "nova",
    title: `Task ${index}`,
    status: index === 0 ? "blocked" : "backlog",
    priority: "high",
    updatedAt: `2026-08-23T1${index}:00:00.000Z`,
    dependencies: index === 0
      ? [{ id: "dep-1", kind: "task", label: "Land the prerequisite", state: "unresolved" }]
      : [],
    primaryBlockerId: index === 0 ? "dep-1" : null,
    nextStep: { summary: `Do step ${index}`, requiresApproval: false },
  }));
  const reminders = [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `reminder-${index}`,
      kind: "reminder",
      familiarId: "nova",
      title: `Reminder ${index}`,
      status: index === 0 ? "fired" : "pending",
      fireAt: `2026-08-24T1${index}:00:00.000Z`,
      updatedAt: "2026-08-23T12:00:00.000Z",
    })),
    { id: "other", kind: "reminder", familiarId: "sage", title: "Not Nova", status: "fired" },
    { id: "agent", kind: "agent", familiarId: "nova", title: "Not a reminder", status: "fired" },
  ];

  const overview = buildFamiliarOverview({
    sessions: [], memory: [], tasks, reminders, familiarId: "nova", presence: "active",
  });
  assert.equal(overview.tasks.items.length, FAMILIAR_DASHBOARD_LIMITS.assignedTasks);
  assert.equal(overview.tasks.total, 8);
  assert.equal(overview.reminders.items.length, FAMILIAR_DASHBOARD_LIMITS.reminders);
  assert.equal(overview.reminders.total, 7);
  const blocked = overview.tasks.items.find((task) => task.id === "task-0");
  assert.equal(blocked?.primaryBlockerId, "dep-1");
  assert.equal(blocked?.unresolvedDependencies.items[0]?.label, "Land the prerequisite");
  assert.equal(blocked?.nextStep?.summary, "Do step 0");
  assert.ok(overview.attention.items.some((item) => item.kind === "blocked"));
  assert.ok(overview.attention.items.some((item) => item.kind === "fired_reminder"));
});

test("generated sessions never enter the recent human-conversation list", () => {
  const overview = buildFamiliarOverview({
    sessions: [
      { id: "generated", status: "completed", generated: true, updated_at: "2026-08-23T12:00:00Z" },
      { id: "human", status: "completed", generated: false, updated_at: "2026-08-23T11:00:00Z" },
    ],
    memory: [],
    presence: null,
  });
  assert.deepEqual(overview.sessions.recent.items.map((session) => session.id), ["human"]);
  assert.equal(overview.sessions.recent.total, 1);
});

test("Now does not claim task work when session truth is unavailable", () => {
  const overview = buildFamiliarOverview({
    sessions: [], memory: [], familiarId: "nova", sessionsAvailable: false,
    tasks: [{
      id: "task", familiarId: "nova", title: "Queued task", status: "running",
      nextStep: { summary: "Continue the task" },
    }],
    presence: null,
  });
  assert.deepEqual(overview.now, { kind: "unknown" });
});

test("bounded lists report the pre-cap total so a client knows what it is not seeing", () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `s${index}`,
    status: "completed",
    title: `Session ${index}`,
    updated_at: `2026-08-23T10:${String(index).padStart(2, "0")}:00.000Z`,
  }));
  const overview = buildFamiliarOverview({ sessions: many, memory: [], presence: null });

  assert.equal(
    overview.sessions.recent.items.length,
    FAMILIAR_DASHBOARD_LIMITS.recentSessions,
    "the recent list is capped",
  );
  assert.equal(overview.sessions.recent.total, 40, "the cap does not hide the true total");
  assert.ok(
    overview.sessions.recent.total > overview.sessions.recent.items.length,
    "a bounded list is self-describing",
  );

  const bounded = boundList([1, 2, 3, 4, 5], 2);
  assert.deepEqual(bounded, { items: [1, 2], total: 5 });
});

test("analytics reports null averages rather than zero when nothing was measured", () => {
  const digest = buildFamiliarAnalyticsDigest({
    reports: [],
    reportsTotal: 0,
    activeSessions: 0,
    recentSessions: 0,
  });
  assert.equal(digest.sampleSize, 0);
  for (const [name, value] of Object.entries(digest.averages)) {
    assert.equal(value, null, `${name} must be null, not 0, when there is no sample`);
  }
  assert.equal(digest.windowStart, null);
});

test("analytics figures are tied to the sample they were computed from", () => {
  const digest = buildFamiliarAnalyticsDigest({
    reports: [
      { reportedAt: "2026-08-20T10:00:00.000Z", overallConfidence: 0.5 },
      { reportedAt: "2026-08-22T10:00:00.000Z", overallConfidence: 0.9 },
    ],
    reportsTotal: 17,
    activeSessions: 1,
    recentSessions: 2,
  });
  assert.equal(digest.sampleSize, 2, "the digest states how many reports it used");
  assert.equal(digest.reportsTotal, 17, "and how many exist beyond that sample");
  assert.equal(digest.averages.overallConfidence, 0.7);
  assert.equal(digest.averages.memoryRecall, null, "an unmeasured axis stays null");
  assert.equal(digest.windowStart, "2026-08-20T10:00:00.000Z");
  assert.equal(digest.windowEnd, "2026-08-22T10:00:00.000Z");
});

test("model provenance distinguishes a deliberate pin from an inherited default", () => {
  const pinned = buildFamiliarProfile({
    familiar: { model: "gpt-5.3", configuredModel: "gpt-5.3" },
    contract: null,
  });
  const inherited = buildFamiliarProfile({
    familiar: { model: "gpt-5.3", configuredModel: null },
    contract: null,
  });
  const absent = buildFamiliarProfile({ familiar: {}, contract: null });

  assert.equal(pinned.runtime.modelProvenance, "familiar");
  assert.equal(
    inherited.runtime.modelProvenance,
    "coven_default",
    "the same effective model from the Coven default must not read as a familiar's choice",
  );
  assert.equal(absent.runtime.modelProvenance, "unconfigured");
});

// --- bounds are numbers with behaviour at the limit -------------------------

test("free text is clamped, and the clamp is what makes the payload size predictable", () => {
  const huge = "x".repeat(50_000);
  const clamped = clampDashboardText(huge);
  assert.equal(clamped.length, FAMILIAR_DASHBOARD_LIMITS.textCharacters);
  assert.ok(clamped.endsWith("…"), "a clamped string says it was clamped");

  const overview = buildFamiliarOverview({
    sessions: [{ id: "s1", status: "running", title: huge, updated_at: "2026-08-23T10:00:00.000Z" }],
    memory: [],
    presence: null,
  });
  assert.equal(
    overview.sessions.active.items[0].title.length,
    FAMILIAR_DASHBOARD_LIMITS.textCharacters,
    "an oversized title is clamped at projection time, not left for the serializer",
  );
});

function oversizedResponse() {
  // Deliberately built to exceed the budget by bypassing the projection clamps:
  // this is the "what if the honest payload really is too big" case, and the
  // enforcer must handle it rather than assume the clamps always hold.
  const filler = "y".repeat(70 * 1024);
  return {
    ok: true,
    version: 1,
    familiarId: "sage",
    generatedAt: "2026-08-23T12:00:00.000Z",
    identity: {
      id: "sage",
      displayName: "Sage",
      role: "Researcher",
      pronouns: null,
      avatarUrl: null,
      presence: null,
      lastSeen: null,
    },
    sections: {
      overview: {
        state: "fresh",
        generatedAt: "2026-08-23T12:00:00.000Z",
        data: { filler },
        issues: [],
      },
      profile: {
        state: "fresh",
        generatedAt: "2026-08-23T12:00:00.000Z",
        data: { filler },
        issues: [],
      },
      analytics: {
        state: "fresh",
        generatedAt: "2026-08-23T12:00:00.000Z",
        data: { filler },
        issues: [],
      },
    },
  };
}

test("the byte budget is ENFORCED, and the response says which sections it shed", () => {
  const oversized = oversizedResponse();
  assert.ok(
    serializedDashboardBytes(oversized) > FAMILIAR_DASHBOARD_LIMITS.responseBytes,
    "fixture must actually exceed the budget or this test proves nothing",
  );

  const { response, shed } = enforceDashboardResponseBudget(oversized);

  assert.ok(
    serializedDashboardBytes(response) <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
    "the returned payload must be within the published budget",
  );
  assert.ok(shed.length > 0, "something had to give, and the caller is told what");

  for (const name of shed) {
    const section = response.sections[name];
    assert.equal(section.data, null, `${name} was shed so its data must be gone`);
    assert.equal(
      section.state,
      "unavailable",
      `${name} was shed and must not still claim to be fresh`,
    );
    assert.notEqual(section.state, "empty", `${name} must never be shed into a false empty`);
    assert.ok(
      section.issues.some((issue) => issue.code === "response_budget_exceeded"),
      `${name} must say WHY it is unavailable`,
    );
  }

  // Analytics sheds before Overview or Profile, and the order is fixed so two
  // Caves under the same pressure degrade identically.
  assert.equal(shed[0], "analytics");
  assert.deepEqual(
    enforceDashboardResponseBudget(oversizedResponse()).shed,
    shed,
    "shedding is deterministic across identical inputs",
  );
});

test("budget enforcement is total — even a payload that cannot fit is brought under it", () => {
  const monstrous = oversizedResponse();
  const gigantic = "z".repeat(400 * 1024);
  monstrous.sections.overview.data = { gigantic };
  monstrous.sections.profile.data = { gigantic };
  monstrous.sections.analytics.data = { gigantic };

  const { response } = enforceDashboardResponseBudget(monstrous);
  assert.ok(
    serializedDashboardBytes(response) <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
    "the enforcer must be total, not best-effort",
  );
  assert.equal(response.identity.id, "sage", "identity survives shedding");
});

test("a payload already within budget is returned untouched", () => {
  const small = oversizedResponse();
  small.sections.overview.data = { ok: true };
  small.sections.profile.data = { ok: true };
  small.sections.analytics.data = { ok: true };

  const { response, shed } = enforceDashboardResponseBudget(small);
  assert.deepEqual(shed, [], "nothing is shed when nothing needs to be");
  assert.deepEqual(response, small, "an in-budget payload is not rewritten");
});

console.log("familiar-dashboard.test.ts: ok");
