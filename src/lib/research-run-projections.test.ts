import assert from "node:assert/strict";
import test from "node:test";
import type {
  ResearchRunV1,
  RunEventV1,
} from "./research-protocol/research-run.ts";
import {
  researchMissionToRunProjectionInput,
  selectResearchRunActivity,
  selectResearchRunEvidence,
  selectResearchRunPlan,
  selectResearchRunProjections,
  selectResearchRunReport,
} from "./research-run-projections.ts";
import type { ResearchMission } from "./research-missions.ts";
import { rehydrateResearchRun } from "./research-run-event-reducer.ts";

const RUN_ID = "run_projection_01";
const RUN_UPDATED_AT = "2026-08-30T10:06:00.000Z";

const run: ResearchRunV1 = {
  schema: "opencoven.research-run/v1",
  id: RUN_ID,
  acceptedTopic: {
    question: "Which sources support the migration decision?",
    editedByUser: true,
  },
  execution: {
    location: "local",
    modelExecution: "cave-device",
    modelBinding: {
      familiarId: "sage",
      selection: "pinned",
      model: "research-model",
    },
    strategy: "single-agent",
  },
  privacy: {
    remoteQueries: false,
    remoteContent: false,
    artifactContentSync: false,
    retention: "7-days",
    allowMemoryPromotion: false,
  },
  bounds: {
    wallClockMinutes: 30,
    maxIterations: 3,
    sourceTarget: 3,
    checkpointEvery: 1,
    stopWhenCostUnavailable: true,
  },
  status: "queued",
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: RUN_UPDATED_AT,
  nextEventSequence: 1,
};

function event(
  sequence: number,
  type: RunEventV1["type"],
  data: Record<string, unknown> = {},
): RunEventV1 {
  return {
    schema: "opencoven.run-event/v1",
    runId: RUN_ID,
    sequence,
    type,
    at: `2026-08-30T10:0${sequence}:00.000Z`,
    data,
  };
}

const events: RunEventV1[] = [
  event(1, "run.created", {
    activity: "Run created",
    prompt: "private prompt that must never become activity",
    plan: {
      revision: 1,
      stages: [
        { id: "scope", label: "Frame the question", status: "completed" },
        { id: "source-scan", label: "Scan sources", status: "completed" },
      ],
    },
  }),
  event(2, "phase.started", {
    phase: "challenge",
    activity: "Testing evidence",
    activityDetail: "Comparing independent sources",
    plan: {
      revision: 2,
      stages: [
        { id: "scope", label: "Frame the question", status: "completed" },
        {
          id: "source-triangulation",
          label: "Triangulate sources",
          status: "active",
          supersedes: ["source-scan"],
        },
        { id: "challenge", label: "Challenge claims", status: "active" },
      ],
    },
  }),
  event(3, "model-task.available", {
    stageId: "challenge",
    attempt: 2,
    retryable: true,
    activity: "Retrying the challenge stage",
    prompt: "private model input that must never become activity",
  }),
  event(4, "phase.completed", {
    phase: "challenge",
    sources: 3,
    reviewed: 3,
    retained: 1,
    rejected: 1,
    cited: 1,
    evidence: {
      sources: [
        {
          id: "S1",
          title: "Fresh source",
          url: "https://example.test/fresh",
          sourceType: "web",
          claim: "The migration is reversible.",
          status: "used",
          fetchedAt: "2026-08-29T10:00:00.000Z",
        },
        {
          id: "S2",
          title: "Conflicting source",
          url: "https://example.test/conflicting",
          sourceType: "web",
          claim: "The migration is reversible.",
          status: "conflicting",
          fetchedAt: "2026-07-01T10:00:00.000Z",
        },
        {
          id: "S3",
          title: "Rejected source",
          sourceType: "web",
          status: "rejected",
          reason: "Duplicate evidence",
          fetchedAt: "2025-01-01T10:00:00.000Z",
        },
      ],
      claims: [
        {
          id: "C1",
          text: "The migration is reversible.",
          sourceIds: ["S1", "S2"],
          status: "contradicted",
        },
      ],
      contradictions: [
        {
          id: "contradiction-1",
          claimId: "C1",
          sourceIds: ["S1", "S2"],
          detail: "The sources disagree about rollback guarantees.",
        },
      ],
      rejectedEvidence: [
        { id: "S3", title: "Rejected source", sourceId: "S3", reason: "Duplicate evidence" },
      ],
    },
  }),
  event(5, "artifact.registered", {
    artifact: {
      id: "artifact-report",
      title: "Migration report",
      kind: "report",
      status: "ready",
      contentSync: "not-requested",
    },
    report: {
      outline: [
        { id: "overview", title: "Overview", status: "complete", depth: 0 },
        { id: "decision", title: "Decision", status: "active", depth: 1, detail: "Drafting the trade-offs." },
      ],
      claims: [
        { id: "C1", text: "The migration is reversible.", sourceIds: ["S1", "S2"] },
      ],
      artifacts: [
        { id: "artifact-report", title: "Migration report", kind: "report", status: "ready" },
      ],
      exportStatus: "draft",
    },
  }),
  event(6, "run.status", {
    status: "completed",
    report: {
      exportStatus: "exported",
      exportedAt: RUN_UPDATED_AT,
    },
  }),
];

function fixtureInput() {
  return { state: rehydrateResearchRun(run, [events[2], events[0], events[5], events[1], events[4], events[3]]) };
}

test("Plan projects the original and revised stages, including additions, supersession, and retry", () => {
  const plan = selectResearchRunPlan(fixtureInput());

  assert.equal(plan.original?.revision, 1);
  assert.equal(plan.revised?.revision, 2);
  assert.equal(plan.hasRevision, true);
  assert.deepEqual(plan.addedStageIds, ["source-triangulation", "challenge"]);
  assert.deepEqual(plan.supersededStageIds, ["source-scan"]);
  assert.deepEqual(plan.retryableStageIds, ["challenge"]);
  assert.equal(plan.activeStageId, "source-triangulation");
  assert.deepEqual(
    plan.original?.stages.find((stage) => stage.id === "source-scan"),
    {
      id: "source-scan",
      label: "Scan sources",
      status: "superseded",
      attempt: 1,
      retryable: false,
      revision: 1,
      supersededBy: "source-triangulation",
    },
  );
  assert.equal(plan.revised?.stages.find((stage) => stage.id === "challenge")?.attempt, 2);
});

test("Activity is chronological and only projects explicit user-safe fields", () => {
  const activity = selectResearchRunActivity(fixtureInput());

  assert.deepEqual(activity.entries.map((entry) => entry.sequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(activity.entries.map((entry) => entry.label), [
    "Run created",
    "Testing evidence",
    "Retrying the challenge stage",
    "Challenge completed",
    "Artifact registered",
    "Run status: Completed",
  ]);
  assert.equal(activity.entries[1].detail, "Comparing independent sources");
  assert.equal(activity.entries.some((entry) => entry.detail?.includes("private")), false);
});

test("Activity retains the newest 200 entries after globally sorting out-of-order events", () => {
  const eventCount = 205;
  const activityEvents = Array.from({ length: eventCount }, (_, index) => {
    const sequence = index + 1;
    const chronologicalRank = (sequence * 73) % eventCount;
    return {
      ...event(sequence, "run.status", { activity: `Activity ${sequence}` }),
      at: new Date(Date.UTC(2026, 0, 1) + chronologicalRank * 1_000).toISOString(),
    };
  });
  const expectedSequences = activityEvents
    .slice()
    .sort((left, right) => left.at.localeCompare(right.at) || left.sequence - right.sequence)
    .slice(-200)
    .map((entry) => entry.sequence);

  const activity = selectResearchRunActivity({
    state: {
      ...rehydrateResearchRun(run, activityEvents),
      appliedEvents: activityEvents,
    },
  });

  assert.equal(activity.entries.length, 200);
  assert.deepEqual(activity.entries.map((entry) => entry.sequence), expectedSequences);
});

test("Evidence maps claims to sources and retains contradiction, rejection, counts, and freshness", () => {
  const evidence = selectResearchRunEvidence(fixtureInput());

  assert.deepEqual(evidence.sources.map((source) => source.id), ["S1", "S2", "S3"]);
  assert.deepEqual(evidence.freshness, { fresh: 1, aging: 1, stale: 1, unknown: 0 });
  assert.deepEqual(evidence.claims, [{
    id: "C1",
    text: "The migration is reversible.",
    sourceIds: ["S1", "S2"],
    status: "contradicted",
  }]);
  assert.deepEqual(evidence.contradictions, [{
    id: "contradiction-1",
    claimId: "C1",
    sourceIds: ["S1", "S2"],
    detail: "The sources disagree about rollback guarantees.",
  }]);
  assert.deepEqual(evidence.rejected, [{
    id: "S3",
    title: "Rejected source",
    sourceId: "S3",
    reason: "Duplicate evidence",
  }]);
  assert.deepEqual(evidence.counts, {
    sources: 3,
    reviewed: 3,
    retained: 1,
    rejected: 1,
    cited: 1,
    artifacts: 1,
  });
});

test("Evidence gives anonymous records stable event-scoped IDs without cross-event collisions", () => {
  const anonymousEvents = [
    event(1, "phase.completed", {
      evidence: {
        claims: [{ text: "Anonymous claim alpha", sourceIds: ["S1"], status: "supported" }],
        contradictions: [{
          claim: "Anonymous claim alpha",
          sourceIds: ["S1"],
          detail: "Anonymous contradiction alpha",
        }],
        rejectedEvidence: [{ title: "Anonymous rejection alpha", reason: "Rejected alpha" }],
      },
    }),
    event(2, "phase.completed", {
      evidence: {
        claims: [{ text: "Anonymous claim beta", sourceIds: ["S2"], status: "supported" }],
        contradictions: [{
          claim: "Anonymous claim beta",
          sourceIds: ["S2"],
          detail: "Anonymous contradiction beta",
        }],
        rejectedEvidence: [{ title: "Anonymous rejection beta", reason: "Rejected beta" }],
      },
    }),
  ];
  const input = {
    state: {
      ...rehydrateResearchRun(run, anonymousEvents),
      appliedEvents: anonymousEvents,
    },
  };

  const evidence = selectResearchRunEvidence(input);
  const repeated = selectResearchRunEvidence(input);

  assert.equal(evidence.claims.length, 2);
  assert.equal(evidence.contradictions.length, 2);
  assert.equal(evidence.rejected.length, 2);
  assert.equal(new Set(evidence.claims.map((claim) => claim.id)).size, 2);
  assert.equal(new Set(evidence.contradictions.map((contradiction) => contradiction.id)).size, 2);
  assert.equal(new Set(evidence.rejected.map((rejected) => rejected.id)).size, 2);
  assert.ok(evidence.claims.every((claim) => claim.id.startsWith("evidence-claim-")));
  assert.ok(evidence.contradictions.every((item) => item.id.startsWith("evidence-contradiction-")));
  assert.ok(evidence.rejected.every((item) => item.id.startsWith("evidence-rejected-")));
  assert.deepEqual(
    {
      claims: repeated.claims.map((claim) => claim.id),
      contradictions: repeated.contradictions.map((contradiction) => contradiction.id),
      rejected: repeated.rejected.map((rejected) => rejected.id),
    },
    {
      claims: evidence.claims.map((claim) => claim.id),
      contradictions: evidence.contradictions.map((contradiction) => contradiction.id),
      rejected: evidence.rejected.map((rejected) => rejected.id),
    },
  );
});

test("Report projects progressive outline, claim citations, artifact metadata, and export state", () => {
  const report = selectResearchRunReport(fixtureInput());

  assert.deepEqual(report.outline, [
    { id: "overview", title: "Overview", status: "complete", depth: 0 },
    { id: "decision", title: "Decision", status: "active", depth: 1, detail: "Drafting the trade-offs." },
  ]);
  assert.deepEqual(report.claims, [{
    id: "C1",
    text: "The migration is reversible.",
    sourceIds: ["S1", "S2"],
    status: "contradicted",
    citationIds: ["S1", "S2"],
  }]);
  assert.deepEqual(report.artifacts, [{
    id: "artifact-report",
    title: "Migration report",
    kind: "report",
    status: "ready",
    contentSync: "not-requested",
  }]);
  assert.equal(report.exportStatus, "exported");
  assert.equal(report.exportedAt, RUN_UPDATED_AT);
});

test("Report gives anonymous claims, sections, and artifacts stable event-scoped IDs", () => {
  const anonymousEvents = [
    event(1, "artifact.registered", {
      report: {
        claims: [{ text: "Anonymous report claim alpha", citationIds: ["S1"] }],
        outline: [{ title: "Anonymous section alpha", status: "complete", depth: 0 }],
        artifacts: [{ title: "Anonymous artifact alpha", kind: "report", status: "ready" }],
      },
    }),
    event(2, "artifact.registered", {
      report: {
        claims: [{ text: "Anonymous report claim beta", citationIds: ["S2"] }],
        outline: [{ title: "Anonymous section beta", status: "active", depth: 1 }],
        artifacts: [{ title: "Anonymous artifact beta", kind: "notes", status: "working" }],
      },
    }),
  ];
  const input = {
    state: {
      ...rehydrateResearchRun(run, anonymousEvents),
      appliedEvents: anonymousEvents,
    },
  };

  const report = selectResearchRunReport(input);
  const repeated = selectResearchRunReport(input);
  const anonymousClaims = report.claims.filter((claim) => claim.text.startsWith("Anonymous report"));

  assert.equal(anonymousClaims.length, 2);
  assert.equal(report.outline.length, 2);
  assert.equal(report.artifacts.length, 2);
  assert.equal(new Set(anonymousClaims.map((claim) => claim.id)).size, 2);
  assert.equal(new Set(report.outline.map((section) => section.id)).size, 2);
  assert.equal(new Set(report.artifacts.map((artifact) => artifact.id)).size, 2);
  assert.ok(anonymousClaims.every((claim) => claim.id.startsWith("report-claim-")));
  assert.ok(report.outline.every((section) => section.id.startsWith("report-section-")));
  assert.ok(report.artifacts.every((artifact) => artifact.id.startsWith("report-artifact-")));
  assert.deepEqual(
    {
      claims: repeated.claims.filter((claim) => claim.text.startsWith("Anonymous report")).map((claim) => claim.id),
      outline: repeated.outline.map((section) => section.id),
      artifacts: repeated.artifacts.map((artifact) => artifact.id),
    },
    {
      claims: anonymousClaims.map((claim) => claim.id),
      outline: report.outline.map((section) => section.id),
      artifacts: report.artifacts.map((artifact) => artifact.id),
    },
  );
});

test("the legacy mission adapter enters the same reducer-backed selector contract", () => {
  const mission = {
    version: 1,
    id: "mission-legacy",
    familiarId: "sage",
    title: "Legacy research",
    intent: "Compare two approaches",
    mode: "brief",
    modeSource: "user",
    deliverable: "Brief",
    constraints: [],
    bounds: run.bounds,
    status: "completed",
    createdAt: "2026-08-30T09:00:00.000Z",
    updatedAt: RUN_UPDATED_AT,
    iterations: [{
      number: 1,
      status: "completed",
      summary: "The first approach is easier to reverse.",
      steps: [{ id: "scope", type: "scope", status: "succeeded" }],
    }],
    artifacts: [{
      key: "findings",
      kind: "findings",
      title: "Findings",
      relativePath: "findings.md",
      iteration: 1,
      state: "published",
      updatedAt: RUN_UPDATED_AT,
    }],
    sources: [],
  } as ResearchMission;
  const input = researchMissionToRunProjectionInput(mission);
  const projections = selectResearchRunProjections(input);

  assert.equal(input.state.run.id, mission.id);
  assert.equal(input.state.run.status, "completed");
  assert.equal(projections.runId, mission.id);
  assert.equal(projections.report.outline[0]?.title, "Findings");
  assert.equal(projections.report.artifacts[0]?.status, "published");
  assert.equal(projections.report.exportStatus, "exported");
});
