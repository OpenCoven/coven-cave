import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultResearchPlan,
  inferResearchMissionMode,
} from "./research-mission-routing.ts";
import {
  allowedResearchActions,
  describeResearchSchedule,
  ensureStandardArtifactRefs,
  normalizeResearchBounds,
  parseResearchMission,
  RESEARCH_AUDIENCE_MAX_LENGTH,
  RESEARCH_BOUND_LIMITS,
  RESEARCH_CONSTRAINT_MAX_COUNT,
  RESEARCH_CONSTRAINT_MAX_LENGTH,
  RESEARCH_DELIVERABLE_MAX_LENGTH,
  RESEARCH_DIRECTION_MAX_LENGTH,
  RESEARCH_INTENT_MAX_LENGTH,
  RESEARCH_INTENT_MIN_LENGTH,
  RESEARCH_PROJECT_ROOT_MAX_LENGTH,
  RESEARCH_HARNESS_IDS,
  RESEARCH_MODEL_MAX_LENGTH,
  RESEARCH_RUNTIME_DEFAULT_HARNESS,
  RESEARCH_TITLE_MAX_LENGTH,
  researchArtifactKindForMode,
  researchBoundReadings,
  researchContinueLabel,
  researchDiagnosticTrace,
  researchIntentAddsContext,
  researchPhaseMeta,
  researchPhaseStatuses,
  researchSourceStatusCounts,
  type ResearchMission,
  validateCreateResearchMissionInput,
} from "./research-missions.ts";

function validMission(): ResearchMission {
  return {
    version: 1,
    id: "mission-1",
    familiarId: "sage",
    title: "Mission",
    intent: "Investigate the evidence",
    mode: "brief",
    modeSource: "user",
    deliverable: "Brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 30,
      maxIterations: 3,
      sourceTarget: 5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    },
    status: "running",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:01:00.000Z",
    iterations: [{ number: 1, status: "running" }],
    artifacts: [],
    sources: [],
  };
}

test("mission parser validates shared-state fields and reconstructs safe data", () => {
  const parsed = parseResearchMission({ ...validMission(), privatePayload: "do not retain" });
  assert.deepEqual(parsed, validMission());
  assert.equal(parseResearchMission({ ...validMission(), bounds: { maxIterations: 3 } }), null);
  assert.equal(parseResearchMission({
    ...validMission(),
    iterations: [{ number: 1, status: "invented" }],
  }), null);
  assert.equal(parseResearchMission({
    ...validMission(),
    sources: [{ id: "x", title: "X", sourceType: "x", status: "invented" }],
  }), null);
  assert.equal(parseResearchMission({ ...validMission(), projectRoot: "/tmp/root\0hidden" }), null);
  assert.equal(parseResearchMission({
    ...validMission(),
    constraints: ["x".repeat(RESEARCH_CONSTRAINT_MAX_LENGTH + 1)],
  }), null);
});

test("research prompt limits retain the requested intent and direction capacity", () => {
  assert.equal(RESEARCH_INTENT_MAX_LENGTH, 25_000);
  assert.equal(RESEARCH_DIRECTION_MAX_LENGTH, 10_000);
  assert.equal(
    validateCreateResearchMissionInput({ ...validMission(), intent: "i".repeat(RESEARCH_INTENT_MAX_LENGTH) }).ok,
    true,
  );
  assert.equal(
    validateCreateResearchMissionInput({ ...validMission(), intent: "i".repeat(RESEARCH_INTENT_MAX_LENGTH + 1) }).ok,
    false,
  );
});

test("mission parser strips private process-owner provenance from public state", () => {
  const parsed = parseResearchMission({
    ...validMission(),
    iterations: [{
      number: 1,
      status: "running",
      sessionId: "public-session-reference",
      sessionAuthority: {
        kind: "owner-local-daemon",
        socketPath: "/tmp/private-owner.sock",
      },
      sessionOwnerKind: "owner-local-daemon",
    }],
  });
  assert.deepEqual(parsed?.iterations, [{
    number: 1,
    status: "running",
    sessionId: "public-session-reference",
  }]);
  assert.equal("sessionAuthority" in (parsed?.iterations[0] ?? {}), false);
  assert.equal("sessionOwnerKind" in (parsed?.iterations[0] ?? {}), false);
});

test("diagnostic trace keeps the clipboard record bounded to non-content state", () => {
  const mission = validMission();
  mission.intent = "Private research brief: https://example.test/secret";
  mission.projectRoot = "/private/workspace";
  mission.lastError = "Failed reading /private/workspace/source.md";
  mission.iterations = [{
    number: 1,
    status: "failed",
    flowRunId: "file:C:private-workspace-run-1",
    sessionId: "private-research-brief",
    automationRunId: "private research brief",
    summary: "private source https://example.test/secret",
    decisionReason: "private brief detail",
    steps: Array.from({ length: 51 }, () => ({
      id: "private-step-id",
      type: "private phase name",
      status: "failed" as const,
      detail: "failed at /private/workspace/source.md",
    })),
  }];
  mission.artifacts = [{
    key: "private-key",
    kind: "brief",
    title: "Private artifact",
    relativePath: "/private/workspace/artifact.md",
    iteration: 1,
    state: "rejected",
    rejectionReason: "private source https://example.test/secret",
    updatedAt: mission.updatedAt,
  }];
  mission.sources = [{
    id: "source-1",
    title: "Private source",
    url: "https://example.test/secret",
    localPath: "/private/workspace/source.md",
    sourceType: "web",
    status: "rejected",
  }];

  const trace = researchDiagnosticTrace(mission);
  const json = JSON.stringify(trace);

  assert.equal(trace.outcome.hasError, true);
  assert.deepEqual(trace.latestIteration?.flowRun, { value: null, redacted: true });
  assert.deepEqual(trace.latestIteration?.session, { value: null, redacted: true });
  assert.deepEqual(trace.latestIteration?.automationRun, { value: null, redacted: true });
  assert.equal(trace.latestIteration?.phases.recorded, 51);
  assert.equal(trace.latestIteration?.phases.captured, 50);
  assert.equal(trace.latestIteration?.phases.truncated, true);
  assert.equal(trace.latestIteration?.phases.statuses.length, 50);
  assert.deepEqual(trace.latestIteration?.session, { value: null, redacted: true });
  assert.deepEqual(trace.evidence.artifacts, {
    recorded: 1,
    byState: { working: 0, published: 0, rejected: 1 },
    byKind: { brief: 1, report: 0, paper: 0, findings: 0, "source-ledger": 0, "research-log": 0, presentation: 0 },
  });
  for (const privateValue of [
    "Private research brief",
    "private research brief",
    "private-research-brief",
    "file:C:private-workspace-run-1",
    "https://example.test/secret",
    "/private/workspace",
    "private phase name",
    "private-step-id",
    "private-key",
  ]) assert.doesNotMatch(json, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("diagnostic trace retains UUID run references for support correlation", () => {
  const mission = validMission();
  mission.iterations = [{
    number: 1,
    status: "failed",
    flowRunId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    sessionId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    automationRunId: "550e8400-e29b-41d4-a716-446655440000",
  }];

  assert.deepEqual(researchDiagnosticTrace(mission).latestIteration, {
    number: 1,
    status: "failed",
    flowRun: { value: "0f8fad5b-d9cb-469f-a165-70867728950e", redacted: false },
    session: { value: "7c9e6679-7425-40de-944b-e07fc1f90ae7", redacted: false },
    automationRun: { value: "550e8400-e29b-41d4-a716-446655440000", redacted: false },
    startedAt: null,
    finishedAt: null,
    costUsd: null,
    phases: { recorded: 0, captured: 0, truncated: false, statuses: [] },
  });
});

test("Auto-routing is explainable and ambiguous work never loops", () => {
  assert.deepEqual(inferResearchMissionMode("Compare local-first note apps"), {
    mode: "brief",
    reason: "comparison or recommendation request",
  });
  assert.deepEqual(inferResearchMissionMode("Map the database landscape"), {
    mode: "sweep",
    reason: "broad landscape or exhaustive-source request",
  });
  assert.equal(inferResearchMissionMode("Write a literature review").mode, "paper");
  assert.equal(
    inferResearchMissionMode("Run experiments until accuracy plateaus").mode,
    "autoresearch",
  );
  assert.deepEqual(inferResearchMissionMode("Research mushrooms"), {
    mode: "brief",
    reason: "safe default for an ambiguous request",
  });
});

test("mode defaults are finite and match the approved review contract", () => {
  assert.deepEqual(defaultResearchPlan("brief"), {
    mode: "brief",
    deliverables: ["brief"],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 1,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
  });
  assert.equal(defaultResearchPlan("sweep").bounds.sourceTarget, 12);
  assert.equal(defaultResearchPlan("paper").bounds.sourceTarget, 8);
  assert.equal(defaultResearchPlan("autoresearch").bounds.maxIterations, 6);
  assert.equal(defaultResearchPlan("autoresearch").bounds.wallClockMinutes, 240);
  assert.equal(defaultResearchPlan("autoresearch").bounds.stopWhenCostUnavailable, true);
});

test("active work cannot be double-started and checkpoints expose refinement", () => {
  assert.deepEqual(allowedResearchActions({ status: "running" }), ["cancel"]);
  assert.deepEqual(allowedResearchActions({ status: "checkpoint" }), [
    "continue",
    "refine",
    "finish",
    "cancel",
    "archive",
  ]);
  assert.deepEqual(allowedResearchActions({ status: "archived" }), []);
});

test("invalid and out-of-product bounds are rejected", () => {
  assert.equal(normalizeResearchBounds({ wallClockMinutes: Infinity }).ok, false);
  assert.equal(normalizeResearchBounds({ maxIterations: 0 }).ok, false);
  assert.equal(normalizeResearchBounds({ wallClockMinutes: 24 * 60 + 1 }).ok, false);
  assert.equal(normalizeResearchBounds({ maxIterations: 101 }).ok, false);
  assert.deepEqual(
    normalizeResearchBounds({
      wallClockMinutes: 30,
      maxIterations: 2,
      sourceTarget: 10,
      maxSpendUsd: 4.5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    }),
    {
      ok: true,
      value: {
        wallClockMinutes: 30,
        maxIterations: 2,
        sourceTarget: 10,
        maxSpendUsd: 4.5,
        checkpointEvery: 1,
        stopWhenCostUnavailable: true,
      },
    },
  );
});

test("mission creation validates familiar, intent, mode, and bounded input", () => {
  const bounds = {
    wallClockMinutes: 20,
    maxIterations: 1,
    sourceTarget: 6,
    checkpointEvery: 1,
    stopWhenCostUnavailable: false,
  };
  assert.equal(validateCreateResearchMissionInput({ intent: "x", bounds }).ok, false);
  assert.equal(
    validateCreateResearchMissionInput({
      familiarId: "sage",
      intent: "Compare two databases",
      mode: "brief",
      modeSource: "auto",
      deliverable: "brief",
      bounds,
    }).ok,
    true,
  );
  assert.equal(
    validateCreateResearchMissionInput({
      familiarId: "../sage",
      intent: "Compare two databases",
      mode: "brief",
      modeSource: "auto",
      deliverable: "brief",
      bounds,
    }).ok,
    false,
  );
});

test("mission input rejects lossful and NUL-bearing prompt fields", () => {
  const valid = {
    familiarId: "sage",
    intent: "Compare two databases",
    mode: "brief",
    modeSource: "auto",
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
  for (const patch of [
    { intent: "Compare\0 hidden intent" },
    { deliverable: "brief\0 hidden deliverable" },
    { title: "title\0 hidden" },
    { audience: "audience\0 hidden" },
    { projectRoot: "/tmp/project\0hidden" },
    { constraints: ["safe", "unsafe\0hidden"] },
  ]) {
    assert.equal(validateCreateResearchMissionInput({ ...valid, ...patch }).ok, false);
  }

  for (const patch of [
    { intent: `Compare ${"\ud800"} databases` },
    { deliverable: `brief${"\udfff"}` },
    { title: `title${"\ud800"}` },
    { audience: `audience${"\udfff"}` },
    { projectRoot: `/tmp/${"\ud800"}` },
    { constraints: [`safe${"\udfff"}`] },
  ]) {
    const rejected = validateCreateResearchMissionInput({ ...valid, ...patch });
    assert.equal(rejected.ok, false, "unpaired UTF-16 surrogates are rejected before JSON/process transport");
  }

  for (const text of [
    "plain BMP text",
    "astral 😀 text",
    "combining e\u0301 text",
  ]) {
    assert.equal(
      validateCreateResearchMissionInput({ ...valid, intent: `Compare ${text}` }).ok,
      true,
      `${text} remains lossless and valid`,
    );
  }

  assert.equal(validateCreateResearchMissionInput({
    ...valid,
    constraints: Array.from({ length: RESEARCH_CONSTRAINT_MAX_COUNT + 1 }, () => "bounded"),
  }).ok, false, "excess constraints are rejected instead of sliced");
  assert.equal(validateCreateResearchMissionInput({
    ...valid,
    constraints: ["valid", 42],
  }).ok, false, "non-string constraints are rejected instead of discarded");
  assert.equal(validateCreateResearchMissionInput({
    ...valid,
    constraints: ["x".repeat(RESEARCH_CONSTRAINT_MAX_LENGTH + 1)],
  }).ok, false, "overlong constraints are rejected instead of truncated");

  for (const patch of [
    { title: "t".repeat(RESEARCH_TITLE_MAX_LENGTH + 1) },
    { deliverable: "d".repeat(RESEARCH_DELIVERABLE_MAX_LENGTH + 1) },
    { audience: "a".repeat(RESEARCH_AUDIENCE_MAX_LENGTH + 1) },
    { projectRoot: `/${"p".repeat(RESEARCH_PROJECT_ROOT_MAX_LENGTH)}` },
  ]) {
    assert.equal(validateCreateResearchMissionInput({ ...valid, ...patch }).ok, false);
  }

  const boundary = validateCreateResearchMissionInput({
    ...valid,
    title: "t".repeat(RESEARCH_TITLE_MAX_LENGTH),
    deliverable: "d".repeat(RESEARCH_DELIVERABLE_MAX_LENGTH),
    audience: "a".repeat(RESEARCH_AUDIENCE_MAX_LENGTH),
    constraints: ["c".repeat(RESEARCH_CONSTRAINT_MAX_LENGTH)],
  });
  assert.equal(boundary.ok, true);
  if (boundary.ok) {
    assert.equal(boundary.value.title?.length, RESEARCH_TITLE_MAX_LENGTH);
    assert.equal(boundary.value.constraints?.[0]?.length, RESEARCH_CONSTRAINT_MAX_LENGTH);
  }
});

test("intent below the minimum never launches a real session", () => {
  const valid = {
    familiarId: "sage",
    mode: "brief",
    modeSource: "auto",
    deliverable: "brief",
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 1,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
  };
  // Accidental one-word launches are rejected even when everything else is valid.
  const short = validateCreateResearchMissionInput({ ...valid, intent: "x" });
  assert.equal(short.ok, false);
  assert.match((short as { error: string }).error, /at least|between 8/i);
  assert.equal(
    validateCreateResearchMissionInput({ ...valid, intent: "abcdefg" }).ok,
    false,
    "7 chars is below the minimum",
  );
  // Whitespace padding cannot satisfy the minimum.
  assert.equal(
    validateCreateResearchMissionInput({ ...valid, intent: "  ab   " }).ok,
    false,
  );
  // The boundary passes.
  assert.equal(RESEARCH_INTENT_MIN_LENGTH, 8);
  assert.equal(
    validateCreateResearchMissionInput({ ...valid, intent: "a".repeat(RESEARCH_INTENT_MIN_LENGTH) }).ok,
    true,
  );
});

test("composer clamp limits match what the server accepts", () => {
  assert.equal(
    normalizeResearchBounds({
      wallClockMinutes: RESEARCH_BOUND_LIMITS.wallClockMinutes,
      maxIterations: RESEARCH_BOUND_LIMITS.maxIterations,
      sourceTarget: RESEARCH_BOUND_LIMITS.sourceTarget,
      checkpointEvery: RESEARCH_BOUND_LIMITS.checkpointEvery,
      stopWhenCostUnavailable: false,
    }).ok,
    true,
  );
  assert.equal(
    normalizeResearchBounds({
      wallClockMinutes: RESEARCH_BOUND_LIMITS.wallClockMinutes + 1,
      maxIterations: 1,
      sourceTarget: 1,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    }).ok,
    false,
  );
});

test("automation schedules are described in human terms, not raw RRULE", () => {
  assert.equal(describeResearchSchedule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0"), "Daily at 09:00");
  assert.equal(
    describeResearchSchedule("RRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=30;BYDAY=MO,WE,FR"),
    "Weekly on Mon, Wed, Fri at 08:30",
  );
  assert.equal(describeResearchSchedule("RRULE:FREQ=WEEKLY;BYHOUR=7;BYMINUTE=15"), "Weekly at 07:15");
  // Unknown shapes fall back to honest rule text instead of a wrong guess.
  assert.equal(describeResearchSchedule("RRULE:FREQ=HOURLY;INTERVAL=2"), "FREQ=HOURLY;INTERVAL=2");
  assert.equal(describeResearchSchedule(""), "Not scheduled");
  assert.equal(describeResearchSchedule(null), "Not scheduled");
  assert.equal(describeResearchSchedule(undefined), "Not scheduled");
});

// --- researchPhaseStatuses: terminal missions must not lie about progress ---

const PHASE_IDS = ["scope", "gather", "challenge", "synthesize", "control", "publish"];

type PhaseSeed = Record<string, "pending" | "running" | "succeeded" | "failed" | "skipped">;

function missionWithPhases(
  missionStatus: string,
  iterationStatus: string | null,
  steps: PhaseSeed | null,
) {
  return {
    status: missionStatus,
    iterations: iterationStatus === null ? [] : [{
      number: 1,
      status: iterationStatus,
      ...(steps === null ? {} : {
        steps: Object.entries(steps).map(([id, status]) => ({ id, type: "agent", status })),
      }),
    }],
  } as Parameters<typeof researchPhaseStatuses>[0];
}

test("completed mission with a stale step snapshot reads fully succeeded", () => {
  // Screenshot repro: mission COMPLETED while steps still say scope running,
  // everything else pending.
  const mission = missionWithPhases("completed", "completed", {
    scope: "running",
    gather: "pending",
    challenge: "pending",
    synthesize: "pending",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "succeeded", "succeeded", "succeeded", "succeeded", "succeeded"],
  );
});

test("success reconciliation preserves explicit failed and skipped step reports", () => {
  const mission = missionWithPhases("completed", "completed", {
    scope: "succeeded",
    gather: "skipped",
    challenge: "failed",
    synthesize: "running",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "skipped", "failed", "succeeded", "succeeded", "succeeded"],
  );
});

test("failed mission marks the phase where the run died, not always scope", () => {
  const mission = missionWithPhases("failed", "failed", {
    scope: "succeeded",
    gather: "succeeded",
    challenge: "running",
    synthesize: "pending",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "succeeded", "failed", "skipped", "skipped", "skipped"],
  );
});

test("failed mission keeps an explicit failed step and does not invent a second failure", () => {
  const mission = missionWithPhases("failed", "failed", {
    scope: "succeeded",
    gather: "failed",
    challenge: "pending",
    synthesize: "pending",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "failed", "skipped", "skipped", "skipped", "skipped"],
  );
});

test("failed mission without step data fails scope and skips the rest", () => {
  const mission = missionWithPhases("failed", "failed", null);
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["failed", "skipped", "skipped", "skipped", "skipped", "skipped"],
  );
});

test("cancelled mid-run phases read skipped, finished work stays succeeded", () => {
  const mission = missionWithPhases("cancelled", "cancelled", {
    scope: "succeeded",
    gather: "running",
    challenge: "pending",
    synthesize: "pending",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "skipped", "skipped", "skipped", "skipped", "skipped"],
  );
});

test("mission archived while its iteration snapshot still said running settles as skipped", () => {
  const mission = missionWithPhases("archived", "running", {
    scope: "succeeded",
    gather: "running",
    challenge: "pending",
    synthesize: "pending",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "skipped", "skipped", "skipped", "skipped", "skipped"],
  );
});

test("an archived completed mission still reads as a success trajectory", () => {
  const mission = missionWithPhases("archived", "completed", {
    scope: "succeeded",
    gather: "running",
    challenge: "pending",
    synthesize: "pending",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "succeeded", "succeeded", "succeeded", "succeeded", "succeeded"],
  );
});

test("checkpoint iterations settle like success — the run finished its loop", () => {
  const mission = missionWithPhases("checkpoint", "checkpoint", {
    scope: "succeeded",
    gather: "succeeded",
    challenge: "succeeded",
    synthesize: "running",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "succeeded", "succeeded", "succeeded", "succeeded", "succeeded"],
  );
});

test("live missions pass raw step statuses through unchanged", () => {
  const mission = missionWithPhases("running", "running", {
    scope: "succeeded",
    gather: "running",
    challenge: "pending",
    synthesize: "pending",
    control: "pending",
    publish: "pending",
  });
  assert.deepEqual(
    researchPhaseStatuses(mission, PHASE_IDS),
    ["succeeded", "running", "pending", "pending", "pending", "pending"],
  );
  // Queued mission with no iterations yet: everything pending.
  assert.deepEqual(
    researchPhaseStatuses(missionWithPhases("queued", null, null), PHASE_IDS),
    ["pending", "pending", "pending", "pending", "pending", "pending"],
  );
});

test("acceptance: no terminal mission ever renders a running or pending phase", () => {
  const staleSnapshots: Array<PhaseSeed | null> = [
    null,
    { scope: "running" },
    { scope: "succeeded", gather: "running", challenge: "pending" },
    { scope: "pending", gather: "pending", challenge: "pending", synthesize: "pending", control: "pending", publish: "pending" },
    { scope: "succeeded", gather: "failed", challenge: "running" },
  ];
  const settledIterations = ["completed", "checkpoint", "failed", "cancelled", "running", null];
  for (const missionStatus of ["completed", "failed", "cancelled", "archived"]) {
    for (const iterationStatus of settledIterations) {
      for (const steps of staleSnapshots) {
        const statuses = researchPhaseStatuses(
          missionWithPhases(missionStatus, iterationStatus, steps),
          PHASE_IDS,
        );
        for (const status of statuses) {
          assert.ok(
            status !== "running" && status !== "pending",
            `${missionStatus}/${iterationStatus} with ${JSON.stringify(steps)} leaked "${status}"`,
          );
        }
      }
    }
  }
});

// --- researchBoundReadings: over/met bound states must be legible ---

function meterMission(overrides: {
  status?: "running" | "checkpoint" | "paused" | "completed" | "failed" | "archived";
  startedAt?: string;
  finishedAt?: string;
  sources?: number;
  costs?: Array<number | undefined>;
  bounds?: Partial<{ wallClockMinutes: number; sourceTarget: number; maxSpendUsd: number; checkpointEvery: number }>;
}) {
  return {
    status: overrides.status ?? "completed",
    bounds: {
      maxIterations: 1,
      wallClockMinutes: 20,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
      ...overrides.bounds,
    },
    sources: Array.from({ length: overrides.sources ?? 0 }, (_, index) => ({
      id: `s${index}`,
      title: `Source ${index}`,
      sourceType: "web",
      status: "candidate" as const,
    })),
    iterations: (overrides.costs ?? [undefined]).map((costUsd, index) => ({
      number: index + 1,
      status: "completed" as const,
      ...(costUsd === undefined ? {} : { costUsd }),
    })),
    startedAt: overrides.startedAt,
    finishedAt: overrides.finishedAt,
    updatedAt: overrides.finishedAt ?? "2026-07-15T01:00:00Z",
  } as Parameters<typeof researchBoundReadings>[0];
}

function reading(mission: Parameters<typeof researchBoundReadings>[0], id: string, nowMs?: number) {
  const found = researchBoundReadings(mission, nowMs).find((item) => item.id === id);
  assert.ok(found, `missing ${id} reading`);
  return found;
}

test("time past the wall-clock budget reads over, in plain text not just color", () => {
  // Screenshot repro: 49 elapsed minutes against a 20-minute brief budget.
  const mission = meterMission({
    startedAt: "2026-07-15T00:00:00Z",
    finishedAt: "2026-07-15T00:49:00Z",
    sources: 14,
  });
  const time = reading(mission, "time");
  assert.equal(time.value, "49/20 min");
  assert.equal(time.tone, "over");
  assert.equal(time.badge, "over");
  assert.match(time.detail, /stop gate/);
  assert.match(time.detail, /no further iterations/i);
});

test("meeting the source target reads met — it is a goal, not a cap", () => {
  const mission = meterMission({
    startedAt: "2026-07-15T00:00:00Z",
    finishedAt: "2026-07-15T00:10:00Z",
    sources: 14,
  });
  const sources = reading(mission, "sources");
  assert.equal(sources.value, "14/6");
  assert.equal(sources.tone, "met");
  assert.equal(sources.badge, "met");
  assert.match(sources.detail, /goal, not a cap/);
  // Exactly at target also counts as met.
  assert.equal(reading(meterMission({ sources: 6 }), "sources").tone, "met");
});

test("in-budget readings stay neutral with no badges", () => {
  const mission = meterMission({
    startedAt: "2026-07-15T00:00:00Z",
    finishedAt: "2026-07-15T00:12:00Z",
    sources: 3,
    costs: [4.2],
    bounds: { maxSpendUsd: 10 },
  });
  for (const item of researchBoundReadings(mission)) {
    assert.equal(item.tone, "neutral", `${item.id} should be neutral`);
    assert.equal(item.badge, undefined, `${item.id} should have no badge`);
  }
  // At the exact wall-clock boundary the decision banner explains any stop;
  // the meter does not claim "over".
  assert.equal(
    reading(meterMission({ startedAt: "2026-07-15T00:00:00Z", finishedAt: "2026-07-15T00:20:00Z" }), "time").tone,
    "neutral",
  );
  // …but a sub-minute overshoot is still over, even when the rounded display
  // reads at-bound (millisecond comparison, not rounded minutes).
  const justOver = reading(
    meterMission({ startedAt: "2026-07-15T00:00:00Z", finishedAt: "2026-07-15T00:20:20Z" }),
    "time",
  );
  assert.equal(justOver.value, "20/20 min");
  assert.equal(justOver.tone, "over");
});

test("an unfinished mission's clock ticks against now, not the last row write", () => {
  // updatedAt is an hour past start (stale poll write), but only 9.5 real
  // minutes have elapsed — the live clock must read now - startedAt.
  const running = meterMission({ status: "running", startedAt: "2026-07-15T00:00:00Z" });
  assert.equal(reading(running, "time", Date.parse("2026-07-15T00:09:30Z")).value, "10/20 min");
  // Checkpoint/paused missions still burn wall clock — the stop gate compares
  // against now regardless of why the run is waiting (stopBeforeNextIteration).
  const waiting = meterMission({ status: "checkpoint", startedAt: "2026-07-15T00:00:00Z" });
  assert.equal(reading(waiting, "time", Date.parse("2026-07-15T00:14:00Z")).value, "14/20 min");
  // Crossing the budget flips to over live, without waiting for a data refresh.
  const over = reading(running, "time", Date.parse("2026-07-15T00:20:01Z"));
  assert.equal(over.tone, "over");
  assert.equal(over.badge, "over");
});

test("a settled mission's clock freezes even when finishedAt was never recorded", () => {
  // meterMission pins updatedAt to 01:00Z when finishedAt is absent.
  const archived = meterMission({ status: "archived", startedAt: "2026-07-15T00:00:00Z" });
  assert.equal(reading(archived, "time", Date.parse("2026-07-16T12:00:00Z")).value, "60/20 min");
  // And finishedAt always wins over the live clock.
  const finished = meterMission({
    status: "completed",
    startedAt: "2026-07-15T00:00:00Z",
    finishedAt: "2026-07-15T00:12:00Z",
  });
  assert.equal(reading(finished, "time", Date.parse("2026-07-16T12:00:00Z")).value, "12/20 min");
});

test("spend reads over only past the cap and stays honest without one", () => {
  const over = reading(meterMission({ costs: [8, 4.5], bounds: { maxSpendUsd: 10 } }), "spend");
  assert.equal(over.value, "$12.50/$10.00");
  assert.equal(over.tone, "over");
  assert.equal(over.badge, "over");
  const under = reading(meterMission({ costs: [5], bounds: { maxSpendUsd: 10 } }), "spend");
  assert.equal(under.value, "$5.00/$10.00");
  assert.equal(under.tone, "neutral");
  const uncapped = reading(meterMission({ costs: [5] }), "spend");
  assert.equal(uncapped.value, "$5.00 reported");
  assert.equal(uncapped.tone, "neutral");
  assert.match(uncapped.detail, /no spend cap/i);
});

test("missing cost renders quiet, with the honest explanation moved off-screen", () => {
  const spend = reading(meterMission({ costs: [undefined] }), "spend");
  assert.equal(spend.value, "—");
  assert.equal(spend.tone, "neutral");
  assert.match(spend.detail, /Cost unavailable/);
});

test("checkpoint cadence pluralizes correctly", () => {
  assert.equal(reading(meterMission({}), "checkpoint").value, "every 1 iteration");
  assert.equal(
    reading(meterMission({ bounds: { checkpointEvery: 2 } }), "checkpoint").value,
    "every 2 iterations",
  );
});

// --- researchIntentAddsContext: the header must not repeat itself ---

test("intent identical to the title adds nothing — the header shows it once", () => {
  // Screenshot repro: short intents become the title verbatim.
  assert.equal(
    researchIntentAddsContext({
      title: "Optimizing Agents via Automated Self-Performance Evaluations",
      intent: "Optimizing Agents via Automated Self-Performance Evaluations",
    }),
    false,
  );
  // Whitespace and case differences are still the same sentence.
  assert.equal(
    researchIntentAddsContext({
      title: "Compare local-first note apps",
      intent: "  compare   Local-first note APPS ",
    }),
    false,
  );
});

test("truncated and customized titles keep the informative intent line", () => {
  const longIntent = `Compare ${"very ".repeat(20)}long approaches to agent evaluation across benchmarks`;
  assert.equal(
    researchIntentAddsContext({
      title: `${longIntent.replace(/\s+/g, " ").slice(0, 77)}…`,
      intent: longIntent,
    }),
    true,
  );
  assert.equal(
    researchIntentAddsContext({
      title: "Agent self-evaluation brief",
      intent: "Compare approaches to automated self-performance evaluation for agents",
    }),
    true,
  );
});

test("source status counts drive the triage filters", () => {
  assert.deepEqual(researchSourceStatusCounts([]), {
    candidate: 0,
    used: 0,
    conflicting: 0,
    rejected: 0,
  });
  assert.deepEqual(
    researchSourceStatusCounts([
      { status: "candidate" },
      { status: "candidate" },
      { status: "used" },
      { status: "rejected" },
    ]),
    { candidate: 2, used: 1, conflicting: 0, rejected: 1 },
  );
});

// --- researchArtifactKindForMode / ensureStandardArtifactRefs ---

function missionWithArtifacts(
  artifacts: ResearchMission["artifacts"],
  iterations: ResearchMission["iterations"] = [{ number: 2, status: "checkpoint" }],
): ResearchMission {
  return {
    version: 1,
    id: "mission-refs",
    familiarId: "sage",
    title: "Storage decision",
    intent: "Compare SQLite and Postgres",
    mode: "brief",
    modeSource: "user",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 3,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "checkpoint",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T01:00:00.000Z",
    iterations,
    artifacts,
    sources: [],
  };
}

test("researchArtifactKindForMode maps every mode to its deliverable kind", () => {
  assert.equal(researchArtifactKindForMode("sweep"), "report");
  assert.equal(researchArtifactKindForMode("paper"), "paper");
  assert.equal(researchArtifactKindForMode("autoresearch"), "findings");
  assert.equal(researchArtifactKindForMode("brief"), "brief");
});

test("ensureStandardArtifactRefs appends missing standard refs after existing ones", () => {
  const primary = {
    key: "primary",
    kind: "brief" as const,
    title: "Storage decision",
    relativePath: "artifacts/primary.md",
    iteration: 2,
    state: "working" as const,
    updatedAt: "2026-07-24T00:30:00.000Z",
  };
  const result = ensureStandardArtifactRefs(missionWithArtifacts([primary]));
  assert.equal(result.artifacts.length, 4);
  assert.equal(result.artifacts[0], primary, "primary stays first and untouched");
  assert.deepEqual(
    result.artifacts.slice(1).map((artifact) => [artifact.key, artifact.kind, artifact.relativePath]),
    [
      ["findings", "findings", "findings.md"],
      ["source-ledger", "source-ledger", "sources.json"],
      ["research-log", "research-log", "research-log.md"],
    ],
  );
  for (const artifact of result.artifacts.slice(1)) {
    assert.equal(artifact.state, "working");
    assert.equal(artifact.iteration, 2, "backfilled refs adopt the latest iteration number");
    assert.equal(artifact.updatedAt, "2026-07-24T00:30:00.000Z", "backfilled refs stamped no fresher than the primary");
  }
});

test("ensureStandardArtifactRefs stamps refs from createdAt when no primary exists", () => {
  const result = ensureStandardArtifactRefs(missionWithArtifacts([]));
  assert.equal(result.artifacts.length, 3);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.updatedAt, "2026-07-24T00:00:00.000Z");
  }
});

test("ensureStandardArtifactRefs is identity when nothing is missing and never overwrites", () => {
  const complete = ensureStandardArtifactRefs(missionWithArtifacts([{
    key: "primary",
    kind: "brief",
    title: "Storage decision",
    relativePath: "artifacts/primary.md",
    iteration: 1,
    state: "working",
    updatedAt: "2026-07-24T00:30:00.000Z",
  }]));
  assert.equal(ensureStandardArtifactRefs(complete), complete, "same object when complete");

  const customFindings = {
    key: "findings",
    kind: "findings" as const,
    title: "Custom findings title",
    relativePath: "findings.md",
    knowledgeId: "research-mission-refs-findings",
    iteration: 1,
    state: "published" as const,
    updatedAt: "2026-07-24T00:10:00.000Z",
  };
  const result = ensureStandardArtifactRefs(missionWithArtifacts([customFindings]));
  assert.equal(
    result.artifacts.find((artifact) => artifact.key === "findings"),
    customFindings,
    "existing refs are never overwritten",
  );
  assert.equal(result.artifacts.length, 3);
});

// --- researchContinueLabel: Continue must say what it will actually do ---

test("Continue is labeled with its real consequence", () => {
  const bounds = { maxIterations: 3, wallClockMinutes: 20, sourceTarget: 6, checkpointEvery: 1, stopWhenCostUnavailable: false };
  const startedAt = "2026-07-15T00:00:00Z";
  const tenMinutesIn = Date.parse("2026-07-15T00:10:00Z");
  const withinPlan = researchContinueLabel(
    { iterations: [{ number: 1, status: "checkpoint" }], bounds, startedAt },
    tenMinutesIn,
  );
  assert.equal(withinPlan.label, "Continue (i2/3)");
  assert.equal(withinPlan.gated, false);
  // Even ungated, the sentence is a request, not a promise — the runner
  // re-checks its stop gates with live clocks.
  assert.match(withinPlan.description, /asks the runner to start iteration 2 of 3/);
  assert.match(withinPlan.description, /stop gates are re-checked/);

  // Screenshot repro: a completed 1/1 brief offered a primary Continue that
  // the runner would refuse (stopBeforeNextIteration: iteration limit).
  const beyond = researchContinueLabel(
    {
      iterations: [{ number: 1, status: "completed" }],
      bounds: { ...bounds, maxIterations: 1 },
      startedAt,
    },
    tenMinutesIn,
  );
  assert.equal(beyond.label, "Continue (i2/1)");
  assert.equal(beyond.gated, true);
  assert.match(beyond.description, /past the planned 1/);
  assert.match(beyond.description, /iteration limit/);
});

test("Continue reports every runner stop gate, not just the iteration limit", () => {
  const bounds = { maxIterations: 3, wallClockMinutes: 20, sourceTarget: 6, checkpointEvery: 1, stopWhenCostUnavailable: false };
  const startedAt = "2026-07-15T00:00:00Z";
  const iterations = [{ number: 1, status: "checkpoint" as const, finishedAt: "2026-07-15T00:10:00Z", costUsd: 5 }];

  // Wall-clock budget spent (>= gate, live clock): in-plan Continue is gated.
  const wallClock = researchContinueLabel(
    { iterations, bounds, startedAt },
    Date.parse("2026-07-15T00:20:00Z"),
  );
  assert.equal(wallClock.gated, true);
  assert.match(wallClock.description, /wall-clock budget is spent/);
  // One millisecond under the budget stays ungated.
  assert.equal(
    researchContinueLabel({ iterations, bounds, startedAt }, Date.parse("2026-07-15T00:20:00Z") - 1).gated,
    false,
  );

  // Reported spend at the cap (>= gate, exact equality refuses).
  const spend = researchContinueLabel(
    { iterations, bounds: { ...bounds, maxSpendUsd: 5 }, startedAt },
    Date.parse("2026-07-15T00:10:00Z"),
  );
  assert.equal(spend.gated, true);
  assert.match(spend.description, /reported spend has reached the \$5 cap/);

  // Missing-cost policy: a finished iteration without costUsd pauses for review.
  const noCost = researchContinueLabel(
    {
      iterations: [{ number: 1, status: "checkpoint" as const, finishedAt: "2026-07-15T00:10:00Z" }],
      bounds: { ...bounds, stopWhenCostUnavailable: true },
      startedAt,
    },
    Date.parse("2026-07-15T00:10:00Z"),
  );
  assert.equal(noCost.gated, true);
  assert.match(noCost.description, /finished without reporting cost/);
});

// --- bound readings: a bar only where a denominator exists -----------------

test("bound readings carry a clamped progress ratio, and only where one exists", () => {
  const mission = validMission();
  mission.startedAt = new Date(Date.now() - 15 * 60_000).toISOString();
  mission.sources = [
    { id: "s1", title: "One", sourceType: "web", status: "used" },
    { id: "s2", title: "Two", sourceType: "web", status: "used" },
  ];
  const byId = Object.fromEntries(
    researchBoundReadings(mission).map((reading) => [reading.id, reading]),
  );
  // 15 of 30 minutes, 2 of 5 sources.
  assert.equal(byId.time.progress, 0.5);
  assert.equal(byId.sources.progress, 0.4);
  // A cadence is not a fraction of anything, and spend with no cap has no
  // denominator — those readings ship no bar rather than a meaningless one.
  assert.equal(byId.checkpoint.progress, undefined);
  assert.equal(byId.spend.progress, undefined);
});

test("an overrun pins its bar at 1 while the tone still says over", () => {
  const mission = validMission();
  mission.startedAt = new Date(Date.now() - 300 * 60_000).toISOString();
  const time = researchBoundReadings(mission).find((reading) => reading.id === "time");
  assert.equal(time?.progress, 1, "clamped, never past the track");
  assert.equal(time?.tone, "over");
  assert.equal(time?.badge, "over");
});

test("a zero source target yields no bar instead of a divide-by-zero", () => {
  const mission = validMission();
  mission.bounds = { ...mission.bounds, sourceTarget: 0 };
  const sources = researchBoundReadings(mission).find((reading) => reading.id === "sources");
  assert.equal(sources?.progress, undefined);
});

test("a capped spend gets a bar measured against the cap", () => {
  const mission = validMission();
  mission.bounds = { ...mission.bounds, maxSpendUsd: 4 };
  mission.iterations = [{ number: 1, status: "completed", costUsd: 1 }];
  const spend = researchBoundReadings(mission).find((reading) => reading.id === "spend");
  assert.equal(spend?.progress, 0.25);
});

// --- phase meta: reports findings, never invents them ----------------------

test("phase meta reports real counts and says — when it has nothing", () => {
  const mission = validMission();
  mission.status = "running";
  mission.sources = [
    { id: "s1", title: "One", sourceType: "web", status: "used" },
    { id: "s2", title: "Two", sourceType: "web", status: "conflicting" },
  ];
  mission.artifacts = [];
  mission.iterations = [{
    number: 1,
    status: "running",
    steps: [
      { id: "scope", type: "scope", status: "succeeded" },
      { id: "gather", type: "gather", status: "running" },
    ],
  }];
  const meta = researchPhaseMeta(mission, PHASE_IDS);
  assert.deepEqual(meta.slice(0, 3), ["bounds set", "2/5 src", "1 conflicting"]);
  // Nothing has been synthesized and nothing is waiting on a person.
  assert.equal(meta[4], "—");
  assert.equal(meta[5], "gated");
});

test("phase meta flags the checkpoint as the reader's turn", () => {
  const mission = validMission();
  mission.status = "checkpoint";
  mission.iterations = [{ number: 1, status: "checkpoint" }];
  assert.equal(researchPhaseMeta(mission, PHASE_IDS)[4], "your turn");
});

test("phase meta counts artifacts but never the rejected ones", () => {
  const mission = validMission();
  mission.status = "running";
  mission.iterations = [{
    number: 1,
    status: "running",
    steps: [{ id: "synthesize", type: "synthesize", status: "running" }],
  }];
  mission.artifacts = [
    { key: "a", kind: "brief", title: "A", relativePath: "a.md", iteration: 1, state: "working", updatedAt: "2026-08-01T00:00:00.000Z" },
    { key: "b", kind: "brief", title: "B", relativePath: "b.md", iteration: 1, state: "rejected", updatedAt: "2026-08-01T00:00:00.000Z" },
  ];
  assert.equal(researchPhaseMeta(mission, PHASE_IDS)[3], "1 artifact");
});

test("a succeeded publish with nothing published says so, never \"shipped\"", () => {
  const mission = validMission();
  mission.status = "completed";
  mission.artifacts = [];
  assert.equal(researchPhaseMeta(mission, PHASE_IDS)[5], "none published");
});

test("phase meta reports published artifacts rather than a bare shipped", () => {
  const mission = validMission();
  mission.status = "completed";
  mission.artifacts = [
    { key: "a", kind: "brief", title: "A", relativePath: "a.md", iteration: 1, state: "published", updatedAt: "2026-08-01T00:00:00.000Z" },
  ];
  assert.equal(researchPhaseMeta(mission, PHASE_IDS)[5], "1 published");
});

test("a failed challenge says where the run stopped", () => {
  const mission = validMission();
  mission.status = "failed";
  mission.iterations = [{
    number: 1,
    status: "failed",
    steps: [
      { id: "scope", type: "scope", status: "succeeded" },
      { id: "gather", type: "gather", status: "succeeded" },
      { id: "challenge", type: "challenge", status: "failed" },
    ],
  }];
  assert.equal(researchPhaseMeta(mission, PHASE_IDS)[2], "stopped here");
});

test("a zero source target reports the count alone, never \"N/0 src\"", () => {
  const mission = validMission();
  mission.status = "running";
  mission.bounds = { ...mission.bounds, sourceTarget: 0 };
  mission.sources = [
    { id: "s1", title: "One", sourceType: "web", status: "used" },
  ] as ResearchMission["sources"];
  mission.iterations = [{
    number: 1,
    status: "running",
    steps: [{ id: "gather", type: "gather", status: "running" }],
  }];
  assert.equal(researchPhaseMeta(mission, PHASE_IDS)[1], "1 src");
});

// ─── mission runtime selection (cave-hhwc5) ──────────────────────────────────
// A mission used to inherit the familiar's Coven binding with no override, so a
// codex-bound familiar could not run Research at all against a daemon lacking
// `sessionLaunchPolicy`. The runtime is now chosen per mission and defaults to
// copilot, the one Cave launches directly.
{
  const { COMPATIBILITY_ADAPTERS } = await import("./harness-adapters.ts");
  // The allowlist is duplicated in research-missions.ts to keep this shared
  // client/server contract free of adapter-registry imports. Pin the two
  // together so a new adapter cannot drift out of it unnoticed.
  assert.deepEqual(
    [...RESEARCH_HARNESS_IDS].sort(),
    COMPATIBILITY_ADAPTERS.map((adapter) => adapter.id).sort(),
    "every compatibility adapter must be selectable as a research runtime",
  );
  assert.ok(
    (RESEARCH_HARNESS_IDS as readonly string[]).includes(RESEARCH_RUNTIME_DEFAULT_HARNESS),
    "the default runtime must itself be an accepted harness",
  );

  const base = {
    familiarId: "sage",
    intent: "Runtime selection contract probe with enough characters.",
    mode: "brief" as const,
    modeSource: "user" as const,
    deliverable: "One sentence.",
    bounds: {
      wallClockMinutes: 10,
      maxIterations: 2,
      sourceTarget: 3,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
  };

  const omitted = validateCreateResearchMissionInput({ ...base });
  assert.equal(omitted.ok, true, "omitting the runtime is valid");
  assert.equal(omitted.value.harness, undefined, "validation does not invent a harness");

  const chosen = validateCreateResearchMissionInput({ ...base, harness: "codex", model: "gpt-5" });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.value.harness, "codex");
  assert.equal(chosen.value.model, "gpt-5");

  // An unknown harness is REFUSED, never silently replaced with the default —
  // running somewhere the caller did not ask for is the lock-in this removes.
  const unknown = validateCreateResearchMissionInput({ ...base, harness: "definitely-not-real" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /harness must be one of/);

  // A flag-shaped model would be parsed as an option rather than its value.
  const flagModel = validateCreateResearchMissionInput({ ...base, model: "--sandbox" });
  assert.equal(flagModel.ok, false);
  assert.match(flagModel.error, /must not begin with '-'/);

  const longModel = validateCreateResearchMissionInput({
    ...base,
    model: "m".repeat(RESEARCH_MODEL_MAX_LENGTH + 1),
  });
  assert.equal(longModel.ok, false);
}
