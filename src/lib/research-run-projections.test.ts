import assert from "node:assert/strict";
import test from "node:test";
import type {
  ResearchRunV1,
  RunEventV1,
} from "./research-protocol/research-run.ts";
import {
  hydrateResearchRunProjectionInput,
  researchMissionToRunProjectionInput,
  selectResearchRunActivity,
  selectResearchRunEvidence,
  selectResearchRunPlan,
  selectResearchRunProjections,
  selectResearchRunReport,
} from "./research-run-projections.ts";
import type { ResearchMission } from "./research-missions.ts";
import {
  createResearchRunEventState,
  rehydrateResearchRun,
  reduceResearchRunEvent,
} from "./research-run-event-reducer.ts";

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

function finalManifestWithArtifact(
  artifact: Partial<NonNullable<ResearchRunV1["artifactManifest"]>["artifacts"][number]> = {},
): NonNullable<ResearchRunV1["artifactManifest"]> {
  return {
    schema: "opencoven.run-manifest/v1",
    id: "manifest_projection_terminal",
    runId: RUN_ID,
    digest: "a".repeat(64),
    revision: 1,
    state: "final",
    createdAt: run.createdAt,
    finalizedAt: RUN_UPDATED_AT,
    sources: [],
    artifacts: [{
      id: "artifact-terminal",
      kind: "report",
      title: "Final report",
      mediaType: "text/markdown",
      digest: "b".repeat(64),
      bytes: 42,
      placement: "device-local",
      contentSync: "not-requested",
      createdAt: RUN_UPDATED_AT,
      ...artifact,
    }],
    modelExecutions: [],
    usage: {
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      completeness: "unreported",
    },
    retention: {
      policy: "7-days",
      effectivePolicy: "7-days",
      status: "active",
      contentExpiresAt: null,
      updatedAt: RUN_UPDATED_AT,
    },
    deletion: { status: "not_scheduled" },
  };
}

function fixtureInput() {
  return { state: rehydrateResearchRun(run, [events[2], events[0], events[5], events[1], events[4], events[3]]) };
}

test("Current snapshots retain complete historical events for every projection without replaying state", () => {
  const snapshot = {
    ...run,
    status: "completed" as const,
    updatedAt: RUN_UPDATED_AT,
    nextEventSequence: events.length + 1,
  };
  const state = createResearchRunEventState(snapshot);
  const input = {
    state,
    eventHistory: [events[3], events[0], events[5], events[1], events[4], events[2]],
  };

  const projections = selectResearchRunProjections(input);

  assert.equal(projections.plan.original?.revision, 1);
  assert.equal(projections.plan.revised?.revision, 2);
  assert.deepEqual(projections.activity.entries.map((entry) => entry.sequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(projections.evidence.claims.map((claim) => claim.id), ["C1"]);
  assert.deepEqual(projections.evidence.counts, {
    sources: 3,
    reviewed: 3,
    retained: 1,
    rejected: 1,
    cited: 1,
    artifacts: 1,
  });
  assert.deepEqual(projections.report.outline.map((item) => item.id), ["overview", "decision"]);
  assert.equal(projections.report.exportStatus, "exported");
  assert.equal(state.run.status, "completed");
  assert.equal(state.lastEventSequence, 6);
  assert.deepEqual(state.appliedEvents, []);
  assert.deepEqual(state.evidence, {});
});

test("Snapshot projection hydration validates and orders a complete historical prefix", () => {
  const snapshot = {
    ...run,
    status: "completed" as const,
    updatedAt: RUN_UPDATED_AT,
    nextEventSequence: events.length + 1,
  };

  const input = hydrateResearchRunProjectionInput(
    snapshot,
    [events[3], events[0], events[5], events[1], events[4], events[2]],
  );

  assert.deepEqual(input.eventHistory?.map((item) => item.sequence), [1, 2, 3, 4, 5, 6]);
  assert.equal(input.state.run, snapshot);
  assert.equal(input.state.lastEventSequence, 6);
  assert.deepEqual(input.state.appliedEvents, []);
  const nextState = reduceResearchRunEvent(
    input.state,
    event(7, "run.status", { activity: "New live activity" }),
  );
  const updated = selectResearchRunProjections({ ...input, state: nextState });
  assert.equal(nextState.lastEventSequence, 7);
  assert.deepEqual(nextState.appliedEvents.map((item) => item.sequence), [7]);
  assert.deepEqual(updated.activity.entries.map((item) => item.sequence), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(updated.activity.entries.at(-1)?.label, "New live activity");
  assert.throws(
    () => hydrateResearchRunProjectionInput(snapshot, events.slice(1)),
    /complete event prefix through sequence 6/,
  );
  assert.throws(
    () => hydrateResearchRunProjectionInput(snapshot, [
      ...events.slice(0, -1),
      { ...events.at(-1), at: "not-a-timestamp" },
    ]),
    /invalid historical event/,
  );
  assert.throws(
    () => hydrateResearchRunProjectionInput({
      ...snapshot,
      artifactManifest: {
        schema: "opencoven.run-manifest/v1",
        id: "manifest_deleted_projection",
        runId: RUN_ID,
        digest: "a".repeat(64),
        revision: 1,
        state: "final",
        createdAt: run.createdAt,
        finalizedAt: RUN_UPDATED_AT,
        sources: [],
        artifacts: [],
        modelExecutions: [],
        usage: {
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          completeness: "unreported",
        },
        retention: {
          policy: "7-days",
          effectivePolicy: "7-days",
          status: "deleted",
          contentExpiresAt: null,
          updatedAt: RUN_UPDATED_AT,
        },
        deletion: {
          status: "completed",
          requestedAt: RUN_UPDATED_AT,
          completedAt: RUN_UPDATED_AT,
          deletedObjectCount: 1,
          retainedAuditUntil: RUN_UPDATED_AT,
          eventSequence: 1,
        },
      },
    }, events),
    /content\.deleted/,
  );
  assert.throws(
    () => hydrateResearchRunProjectionInput(
      snapshot,
      events,
      { id: "mission-other" } as ResearchMission,
    ),
    /does not belong to snapshot/,
  );
});

test("Historical and newly applied artifact registrations contribute to one projection count", () => {
  const snapshot = {
    ...run,
    nextEventSequence: 2,
  };
  const input = hydrateResearchRunProjectionInput(
    snapshot,
    [event(1, "artifact.registered")],
  );
  const state = reduceResearchRunEvent(input.state, event(2, "artifact.registered"));

  const evidence = selectResearchRunEvidence({ ...input, state });

  assert.equal(state.evidence.artifacts, 1);
  assert.equal(evidence.counts.artifacts, 2);
});

test("Snapshot manifest artifacts remain the baseline for newly applied registrations", () => {
  const snapshot = {
    ...run,
    status: "completed" as const,
    nextEventSequence: 2,
    artifactManifest: {
      schema: "opencoven.run-manifest/v1" as const,
      id: "manifest_artifact_count",
      runId: RUN_ID,
      digest: "a".repeat(64),
      revision: 1,
      state: "final" as const,
      createdAt: run.createdAt,
      finalizedAt: RUN_UPDATED_AT,
      sources: [],
      artifacts: [{
        id: "artifact_existing",
        kind: "report",
        title: "Existing report",
        mediaType: "text/markdown",
        digest: "b".repeat(64),
        bytes: 12,
        placement: "device-local" as const,
        contentSync: "not-requested" as const,
        createdAt: run.createdAt,
      }],
      modelExecutions: [],
      usage: {
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        completeness: "unreported" as const,
      },
      retention: {
        policy: "7-days" as const,
        effectivePolicy: "7-days" as const,
        status: "active" as const,
        contentExpiresAt: null,
        updatedAt: RUN_UPDATED_AT,
      },
      deletion: { status: "not_scheduled" as const },
    },
  };
  const input = hydrateResearchRunProjectionInput(
    snapshot,
    [event(1, "run.created")],
  );
  const state = reduceResearchRunEvent(input.state, event(2, "artifact.registered"));

  const evidence = selectResearchRunEvidence({ ...input, state });

  assert.equal(state.evidence.artifacts, 2);
  assert.equal(evidence.counts.artifacts, 2);
});

test("Final manifests do not imply publication or export for terminal runs", () => {
  for (const status of ["completed", "failed", "cancelled", "expired"] as const) {
    const snapshot: ResearchRunV1 = {
      ...run,
      status,
      updatedAt: RUN_UPDATED_AT,
      artifactManifest: finalManifestWithArtifact(),
      ...(status === "failed"
        ? { failure: { code: "research_failed", message: "Research stopped", retryable: false } }
        : {}),
    };

    const report = selectResearchRunReport({
      state: createResearchRunEventState(snapshot),
    });

    assert.equal(report.artifacts[0]?.status, "ready", status);
    assert.equal(report.exportStatus, "ready", status);
    assert.equal(report.exportedAt, undefined, status);
  }
});

test("Current manifest metadata enriches an event artifact without replacing publication state", () => {
  const snapshot: ResearchRunV1 = {
    ...run,
    status: "completed",
    updatedAt: RUN_UPDATED_AT,
    nextEventSequence: 2,
    artifactManifest: finalManifestWithArtifact({
      id: "artifact-shared",
      kind: "report",
      title: "Final authoritative title",
      contentSync: "synced",
      createdAt: "2026-08-30T10:04:30.000Z",
    }),
  };
  const input = hydrateResearchRunProjectionInput(snapshot, [
    event(1, "artifact.registered", {
      artifact: {
        id: "artifact-shared",
        kind: "draft",
        title: "Working title",
        status: "published",
        contentSync: "pending",
        createdAt: "2026-08-30T10:04:00.000Z",
      },
    }),
  ]);

  const report = selectResearchRunReport(input);

  assert.deepEqual(report.artifacts, [{
    id: "artifact-shared",
    kind: "report",
    title: "Final authoritative title",
    status: "published",
    contentSync: "synced",
    at: "2026-08-30T10:04:30.000Z",
  }]);
  assert.equal(report.exportStatus, "exported");
});

test("Snapshot history preserves the active plan stage without mutating reducer phase state", () => {
  const snapshot = {
    ...run,
    status: "challenging" as const,
    nextEventSequence: 3,
  };
  const input = hydrateResearchRunProjectionInput(snapshot, [
    event(1, "run.created", {
      plan: {
        revision: 1,
        stages: [{ id: "challenge", label: "Challenge evidence", status: "pending" }],
      },
    }),
    event(2, "phase.started", { phase: "challenge" }),
  ]);

  const plan = selectResearchRunPlan(input);

  assert.equal(input.state.activePhase, undefined);
  assert.equal(plan.activeStageId, "challenge");
});

test("Terminal snapshots clear stale active plan stages for every terminal status", () => {
  const terminalCases = [
    { status: "completed", eventType: "run.completed" },
    { status: "failed", eventType: "run.failed" },
    { status: "cancelled", eventType: "run.cancelled" },
    { status: "expired", eventType: "run.status" },
  ] as const;

  for (const { status, eventType } of terminalCases) {
    const snapshot: ResearchRunV1 = {
      ...run,
      status,
      updatedAt: RUN_UPDATED_AT,
      nextEventSequence: 4,
      artifactManifest: finalManifestWithArtifact(),
      ...(status === "failed"
        ? { failure: { code: "research_failed", message: "Research stopped", retryable: false } }
        : {}),
    };
    const input = hydrateResearchRunProjectionInput(snapshot, [
      event(1, "run.created", {
        plan: {
          revision: 1,
          stages: [{ id: "challenge", label: "Challenge evidence", status: "active" }],
        },
      }),
      event(2, "phase.started", { phase: "challenge" }),
      event(3, eventType, { status }),
    ]);

    assert.equal(selectResearchRunPlan(input).activeStageId, undefined, status);
  }
});

test("Plan projects the original and revised stages, including additions, supersession, and retry", () => {
  const plan = selectResearchRunPlan(fixtureInput());

  assert.equal(plan.original?.revision, 1);
  assert.equal(plan.revised?.revision, 2);
  assert.equal(plan.hasRevision, true);
  assert.deepEqual(plan.addedStageIds, ["source-triangulation", "challenge"]);
  assert.deepEqual(plan.supersededStageIds, ["source-scan"]);
  assert.deepEqual(plan.retryableStageIds, ["challenge"]);
  assert.equal(plan.activeStageId, undefined);
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

test("Legacy mission plan revisions count retries only through each chronological iteration", () => {
  const mission = {
    version: 1,
    id: "mission-retry-history",
    familiarId: "sage",
    title: "Retry chronology",
    intent: "Track retry chronology",
    mode: "brief",
    modeSource: "user",
    deliverable: "Brief",
    constraints: [],
    bounds: run.bounds,
    status: "completed",
    createdAt: run.createdAt,
    updatedAt: RUN_UPDATED_AT,
    iterations: [
      {
        number: 1,
        status: "failed",
        startedAt: "2026-08-30T10:00:00.000Z",
        steps: [{ id: "challenge", type: "challenge", status: "failed" }],
      },
      {
        number: 2,
        status: "failed",
        startedAt: "2026-08-30T10:02:00.000Z",
        steps: [{ id: "challenge", type: "challenge", status: "failed" }],
      },
      {
        number: 3,
        status: "completed",
        startedAt: "2026-08-30T10:04:00.000Z",
        steps: [{ id: "challenge", type: "challenge", status: "succeeded" }],
      },
    ],
    artifacts: [],
    sources: [],
  } as ResearchMission;

  const plan = selectResearchRunPlan(researchMissionToRunProjectionInput(mission));

  assert.deepEqual(
    plan.revisions.map((revision) => revision.stages[0]?.attempt),
    [1, 2, 3],
  );
  assert.deepEqual(
    plan.revisions.map((revision) => revision.stages[0]?.retryable),
    [true, true, false],
  );
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

test("Manifest source provenance enriches richer evidence without replacing its semantics", () => {
  const usedId = "evidence_manifest_used";
  const conflictingId = "evidence_manifest_conflicting";
  const rejectedId = "evidence_manifest_rejected";
  const manifestSources = [usedId, conflictingId, rejectedId].map((id, index) => ({
    kind: "public-evidence" as const,
    id,
    contentDigest: String(index + 1).repeat(64),
    snapshotDigest: String(index + 4).repeat(64),
    canonicalUrl: `https://canonical.example.test/${id}`,
    fetchedAt: `2026-08-${String(27 + index).padStart(2, "0")}T10:00:00.000Z`,
  }));
  const snapshot = {
    ...run,
    status: "completed" as const,
    artifactManifest: {
      schema: "opencoven.run-manifest/v1" as const,
      id: "manifest_projection_merge",
      runId: RUN_ID,
      digest: "a".repeat(64),
      revision: 1,
      state: "final" as const,
      createdAt: run.createdAt,
      finalizedAt: RUN_UPDATED_AT,
      sources: manifestSources,
      artifacts: [],
      modelExecutions: [],
      usage: {
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        completeness: "unreported" as const,
      },
      retention: {
        policy: "7-days" as const,
        effectivePolicy: "7-days" as const,
        status: "active" as const,
        contentExpiresAt: null,
        updatedAt: RUN_UPDATED_AT,
      },
      deletion: { status: "not_scheduled" as const },
    },
  };
  const evidenceEvent = event(1, "phase.completed", {
    evidence: {
      sources: [
        {
          id: usedId,
          title: "Primary migration evidence",
          sourceType: "web",
          status: "used",
          freshness: "stale",
          claim: "The migration can be reversed.",
        },
        {
          id: conflictingId,
          title: "Conflicting migration evidence",
          sourceType: "web",
          status: "conflicting",
          fetchedAt: "2025-01-01T10:00:00.000Z",
          claim: "The migration can be reversed.",
        },
      ],
    },
  });
  const mission = {
    version: 1,
    id: "mission-manifest-merge",
    familiarId: "sage",
    title: "Manifest merge",
    intent: "Preserve evidence semantics",
    mode: "brief",
    modeSource: "user",
    deliverable: "Brief",
    constraints: [],
    bounds: run.bounds,
    status: "completed",
    createdAt: run.createdAt,
    updatedAt: RUN_UPDATED_AT,
    iterations: [],
    artifacts: [],
    sources: [{
      id: rejectedId,
      title: "Rejected mission evidence",
      sourceType: "document",
      status: "rejected",
      claim: "The migration is irreversible.",
      note: "Superseded source",
    }],
  } as ResearchMission;

  const evidence = selectResearchRunEvidence({
    state: rehydrateResearchRun(snapshot, [evidenceEvent]),
    mission,
  });

  assert.deepEqual(
    evidence.sources.map((source) => ({
      id: source.id,
      title: source.title,
      status: source.status,
      sourceType: source.sourceType,
      url: source.url,
      fetchedAt: source.fetchedAt,
      freshness: source.freshness,
      contentDigest: source.contentDigest,
      snapshotDigest: source.snapshotDigest,
    })),
    [
      {
        id: usedId,
        title: "Primary migration evidence",
        status: "used",
        sourceType: "web",
        url: `https://canonical.example.test/${usedId}`,
        fetchedAt: "2026-08-27T10:00:00.000Z",
        freshness: "stale",
        contentDigest: "1".repeat(64),
        snapshotDigest: "4".repeat(64),
      },
      {
        id: conflictingId,
        title: "Conflicting migration evidence",
        status: "conflicting",
        sourceType: "web",
        url: `https://canonical.example.test/${conflictingId}`,
        fetchedAt: "2026-08-28T10:00:00.000Z",
        freshness: "fresh",
        contentDigest: "2".repeat(64),
        snapshotDigest: "5".repeat(64),
      },
      {
        id: rejectedId,
        title: "Rejected mission evidence",
        status: "rejected",
        sourceType: "document",
        url: `https://canonical.example.test/${rejectedId}`,
        fetchedAt: "2026-08-29T10:00:00.000Z",
        freshness: "fresh",
        contentDigest: "3".repeat(64),
        snapshotDigest: "6".repeat(64),
      },
    ],
  );
  assert.equal(evidence.counts.retained, 1);
  assert.equal(evidence.counts.rejected, 1);
  assert.deepEqual(
    evidence.claims.map((claim) => ({ text: claim.text, status: claim.status })),
    [
      { text: "The migration can be reversed.", status: "contradicted" },
      { text: "The migration is irreversible.", status: "rejected" },
    ],
  );
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
