import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultResearchPlan,
  inferResearchMissionMode,
} from "./research-mission-routing.ts";
import {
  allowedResearchActions,
  describeResearchSchedule,
  normalizeResearchBounds,
  RESEARCH_BOUND_LIMITS,
  researchBoundReadings,
  researchIntentAddsContext,
  researchPhaseStatuses,
  validateCreateResearchMissionInput,
} from "./research-missions.ts";

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
  startedAt?: string;
  finishedAt?: string;
  sources?: number;
  costs?: Array<number | undefined>;
  bounds?: Partial<{ wallClockMinutes: number; sourceTarget: number; maxSpendUsd: number; checkpointEvery: number }>;
}) {
  return {
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

function reading(mission: Parameters<typeof researchBoundReadings>[0], id: string) {
  const found = researchBoundReadings(mission).find((item) => item.id === id);
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
