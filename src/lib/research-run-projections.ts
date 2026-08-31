import type {
  ResearchArtifactRef,
  ResearchMission,
  ResearchMissionStatus,
  ResearchSourceRef,
} from "./research-missions.ts";
import {
  createResearchRunEventState,
  type ResearchRunEventState,
  type ResearchRunPhaseV1,
} from "./research-run-event-reducer.ts";
import {
  parseRunEventV1,
  validateRunManifestDeletionEventV1,
  type ResearchRunStatusV1,
  type ResearchRunV1,
  type RunEventV1,
} from "./research-protocol/research-run.ts";
import type {
  RunManifestSourceV1,
} from "./research-protocol/run-manifest.ts";

/**
 * Presentation data carried by canonical run events. These are deliberately
 * local types: the v1 event protocol stays opaque and forward-compatible while
 * the Desk can consume the fields the reducer already preserves.
 */
export type ResearchRunProjectionInput = {
  state: ResearchRunEventState;
  /** Validated event history represented by the current snapshot, kept separate from newly applied events. */
  eventHistory?: readonly RunEventV1[];
  /** Legacy Desk data until the run gateway replaces the mission endpoint. */
  mission?: ResearchMission | null;
};

export type ResearchRunPlanStageStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "skipped"
  | "superseded";

export type ResearchRunPlanStage = {
  id: string;
  label: string;
  status: ResearchRunPlanStageStatus;
  attempt: number;
  retryable: boolean;
  revision: number;
  detail?: string;
  supersedes?: readonly string[];
  supersededBy?: string;
};

export type ResearchRunPlanRevision = {
  revision: number;
  stages: readonly ResearchRunPlanStage[];
  at: string;
  label?: string;
  reason?: string;
};

export type ResearchRunPlanProjection = {
  original: ResearchRunPlanRevision | null;
  revised: ResearchRunPlanRevision | null;
  revisions: readonly ResearchRunPlanRevision[];
  addedStageIds: readonly string[];
  supersededStageIds: readonly string[];
  retryableStageIds: readonly string[];
  activeStageId?: string;
  hasRevision: boolean;
};

export type ResearchRunActivityKind =
  | "run"
  | "phase"
  | "task"
  | "checkpoint"
  | "artifact";

export type ResearchRunActivityEntry = {
  id: string;
  sequence: number;
  at: string;
  kind: ResearchRunActivityKind;
  label: string;
  detail?: string;
  phase?: string;
  stageId?: string;
};

export type ResearchRunActivityProjection = {
  entries: readonly ResearchRunActivityEntry[];
};

export type ResearchRunEvidenceFreshness = "fresh" | "aging" | "stale" | "unknown";

export type ResearchRunEvidenceSource = {
  id: string;
  title: string;
  status: ResearchSourceRef["status"];
  freshness: ResearchRunEvidenceFreshness;
  sourceType?: string;
  url?: string;
  claim?: string;
  publishedAt?: string;
  fetchedAt?: string;
  rejectionReason?: string;
  digest?: string;
  contentDigest?: string;
  snapshotDigest?: string;
  availability?: "device-local";
};

export type ResearchRunEvidenceClaim = {
  id: string;
  text: string;
  sourceIds: readonly string[];
  status: "supported" | "contradicted" | "unresolved" | "rejected";
};

export type ResearchRunContradiction = {
  id: string;
  claimId?: string;
  claim?: string;
  sourceIds: readonly string[];
  detail?: string;
};

export type ResearchRunRejectedEvidence = {
  id: string;
  title: string;
  sourceId?: string;
  reason?: string;
};

export type ResearchRunEvidenceCounts = {
  sources?: number;
  reviewed?: number;
  retained?: number;
  rejected?: number;
  cited?: number;
  artifacts?: number;
};

export type ResearchRunEvidenceProjection = {
  sources: readonly ResearchRunEvidenceSource[];
  claims: readonly ResearchRunEvidenceClaim[];
  contradictions: readonly ResearchRunContradiction[];
  rejected: readonly ResearchRunRejectedEvidence[];
  counts: ResearchRunEvidenceCounts;
  freshness: Readonly<Record<ResearchRunEvidenceFreshness, number>>;
};

export type ResearchRunReportOutlineStatus = "pending" | "active" | "complete" | "blocked";

export type ResearchRunReportOutlineItem = {
  id: string;
  title: string;
  status: ResearchRunReportOutlineStatus;
  depth: number;
  detail?: string;
};

export type ResearchRunReportClaim = ResearchRunEvidenceClaim & {
  citationIds: readonly string[];
};

export type ResearchRunReportArtifact = {
  id: string;
  title: string;
  kind?: string;
  status: "working" | "ready" | "published" | "rejected";
  contentSync?: string;
  at?: string;
};

export type ResearchRunExportStatus = "not_started" | "draft" | "ready" | "exported" | "failed";

export type ResearchRunReportProjection = {
  outline: readonly ResearchRunReportOutlineItem[];
  claims: readonly ResearchRunReportClaim[];
  artifacts: readonly ResearchRunReportArtifact[];
  exportStatus: ResearchRunExportStatus;
  exportDetail?: string;
  exportedAt?: string;
};

export type ResearchRunProjections = {
  runId: string;
  plan: ResearchRunPlanProjection;
  activity: ResearchRunActivityProjection;
  evidence: ResearchRunEvidenceProjection;
  report: ResearchRunReportProjection;
  sync: ResearchRunEventState["sync"];
};

const MAX_ITEMS = 200;
const MAX_TEXT = 320;
const MAX_DETAIL = 512;

type ProjectionIdNamespace =
  | "evidence-claim"
  | "evidence-contradiction"
  | "evidence-rejected"
  | "report-claim"
  | "report-section"
  | "report-artifact";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "undefined") return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(String(value));
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

function projectionIdentityHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function projectionFallbackId(
  namespace: ProjectionIdNamespace,
  event: RunEventV1,
  semanticIdentity: unknown,
): string {
  return `${namespace}-${event.sequence}-${projectionIdentityHash(semanticIdentity)}`;
}

function textValue(value: unknown, maximum = MAX_TEXT): string | undefined {
  if (typeof value !== "string" || value.includes("\0")) return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length <= maximum ? text : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values: string[] = [];
  for (const item of value.slice(0, 40)) {
    const text = textValue(item, 160);
    if (text && !values.includes(text)) values.push(text);
  }
  return values;
}

function safeUrl(value: unknown): string | undefined {
  const url = textValue(value, 2_048);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function humanize(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusForStage(value: unknown): ResearchRunPlanStageStatus {
  if (value === "active" || value === "running") return "active";
  if (value === "completed" || value === "complete" || value === "succeeded") return "completed";
  if (value === "failed" || value === "error") return "failed";
  if (value === "skipped") return "skipped";
  if (value === "superseded") return "superseded";
  return "pending";
}

function eventData(event: RunEventV1): Record<string, unknown> {
  return event.data;
}

function projectionEvents(input: ResearchRunProjectionInput): RunEventV1[] {
  const bySequence = new Map<number, RunEventV1>();
  for (const event of input.eventHistory ?? []) bySequence.set(event.sequence, event);
  for (const event of input.state.appliedEvents) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

function activePhaseFromEvents(events: readonly RunEventV1[]): ResearchRunPhaseV1 | undefined {
  let activePhase: ResearchRunPhaseV1 | undefined;
  for (const event of events) {
    if (event.type !== "phase.started" && event.type !== "phase.completed") continue;
    const phase = event.data.phase;
    if (phase !== "scope" && phase !== "challenge" && phase !== "synthesize" && phase !== "control") {
      continue;
    }
    if (event.type === "phase.started") activePhase = phase;
    else if (activePhase === phase) activePhase = undefined;
  }
  return activePhase;
}

export function hydrateResearchRunProjectionInput(
  run: ResearchRunV1,
  historicalValues: readonly unknown[],
  mission?: ResearchMission | null,
): ResearchRunProjectionInput {
  const expectedLastSequence = run.nextEventSequence - 1;
  const eventHistory: RunEventV1[] = [];
  for (const value of historicalValues) {
    const parsed = parseRunEventV1(value);
    if (!parsed.ok || parsed.value.runId !== run.id) {
      throw new TypeError("Research Run projection history contains an invalid historical event or foreign run");
    }
    eventHistory.push(parsed.value);
  }
  eventHistory.sort((left, right) => left.sequence - right.sequence);
  if (
    eventHistory.length !== expectedLastSequence
    || eventHistory.some((event, index) => event.sequence !== index + 1)
  ) {
    throw new RangeError(
      `Research Run projection history must be a complete event prefix through sequence ${expectedLastSequence}`,
    );
  }
  const validatedHistory = validateRunManifestDeletionEventV1(run, eventHistory);
  if (!validatedHistory.ok) {
    throw new RangeError(
      `Research Run projection history is inconsistent with its snapshot: ${validatedHistory.error.message}`,
    );
  }
  if (mission && run.id !== mission.id && run.id !== `run_${mission.id}`) {
    throw new RangeError("Research mission does not belong to snapshot Research Run");
  }
  return {
    state: createResearchRunEventState(run),
    eventHistory,
    ...(mission !== undefined ? { mission } : {}),
  };
}

function eventPlanRevision(value: unknown, fallbackRevision: number, at: string): ResearchRunPlanRevision | undefined {
  if (!isRecord(value) || !Array.isArray(value.stages ?? value.steps)) return undefined;
  const rawStages = (value.stages ?? value.steps) as unknown[];
  const stages: ResearchRunPlanStage[] = [];
  for (const raw of rawStages.slice(0, MAX_ITEMS)) {
    if (!isRecord(raw)) continue;
    const id = textValue(raw.id ?? raw.stageId, 120);
    if (!id || stages.some((stage) => stage.id === id)) continue;
    const label = textValue(raw.label ?? raw.title ?? raw.name ?? raw.type, MAX_TEXT) ?? humanize(id);
    const supersedes = stringArray(raw.supersedes ?? raw.supersedesStageIds ?? raw.replaces);
    stages.push({
      id,
      label,
      status: statusForStage(raw.status),
      attempt: positiveInteger(raw.attempt) ?? 1,
      retryable: raw.retryable === true || raw.status === "failed",
      revision: positiveInteger(value.revision ?? value.version) ?? fallbackRevision,
      ...(textValue(raw.detail, MAX_DETAIL) ? { detail: textValue(raw.detail, MAX_DETAIL) } : {}),
      ...(supersedes.length > 0 ? { supersedes } : {}),
    });
  }
  if (stages.length === 0) return undefined;
  const revision = positiveInteger(value.revision ?? value.version) ?? fallbackRevision;
  return {
    revision,
    stages: stages.map((stage) => ({ ...stage, revision })),
    at: textValue(value.at, 64) ?? at,
    ...(textValue(value.label) ? { label: textValue(value.label) } : {}),
    ...(textValue(value.reason, MAX_DETAIL) ? { reason: textValue(value.reason, MAX_DETAIL) } : {}),
  };
}

function planRevisionsFromEvent(event: RunEventV1): ResearchRunPlanRevision[] {
  const data = eventData(event);
  const plan = data.plan;
  const revisions: ResearchRunPlanRevision[] = [];
  if (isRecord(plan) && Array.isArray(plan.revisions)) {
    for (const [index, value] of plan.revisions.slice(0, MAX_ITEMS).entries()) {
      const revision = eventPlanRevision(value, index + 1, event.at);
      if (revision) revisions.push(revision);
    }
  }
  if (isRecord(plan)) {
    const original = eventPlanRevision(plan.original, 1, event.at);
    const revised = eventPlanRevision(plan.revised ?? plan.current, 2, event.at);
    if (original) revisions.push(original);
    if (revised) revisions.push(revised);
    const single = eventPlanRevision(plan, positiveInteger(data.planRevision) ?? 1, event.at);
    if (single) revisions.push(single);
  }
  const direct = eventPlanRevision(
    { stages: data.stages, revision: data.planRevision },
    positiveInteger(data.planRevision) ?? 1,
    event.at,
  );
  if (direct) revisions.push(direct);
  return revisions;
}

function revisionsByNumber(revisions: readonly ResearchRunPlanRevision[]): ResearchRunPlanRevision[] {
  const byRevision = new Map<number, ResearchRunPlanRevision>();
  for (const revision of revisions) byRevision.set(revision.revision, revision);
  return [...byRevision.values()].sort((left, right) => left.revision - right.revision);
}

function planFromMission(mission: ResearchMission): ResearchRunPlanRevision[] {
  const revisions: ResearchRunPlanRevision[] = [];
  const attempts = new Map<string, number>();
  for (const [index, iteration] of mission.iterations.entries()) {
    if (!iteration.steps?.length) continue;
    const revision = index + 1;
    revisions.push({
      revision,
      at: iteration.startedAt ?? iteration.finishedAt ?? mission.updatedAt,
      stages: iteration.steps.slice(0, MAX_ITEMS).map((step) => {
        const attempt = (attempts.get(step.id) ?? 0) + 1;
        attempts.set(step.id, attempt);
        return {
          id: step.id,
          label: humanize(step.type || step.id),
          status: statusForStage(step.status),
          attempt,
          retryable: step.status === "failed",
          revision,
          ...(textValue(step.detail, MAX_DETAIL) ? { detail: textValue(step.detail, MAX_DETAIL) } : {}),
        };
      }),
    });
  }
  return revisions;
}

function stageRetryUpdates(events: readonly RunEventV1[]): ReadonlyMap<string, { attempt: number; retryable: boolean }> {
  const updates = new Map<string, { attempt: number; retryable: boolean }>();
  for (const event of events) {
    const data = eventData(event);
    const candidate = isRecord(data.stageRetry) ? data.stageRetry : data;
    const stageId = textValue(candidate.stageId ?? candidate.stage, 120);
    const attempt = positiveInteger(candidate.attempt);
    if (!stageId || !attempt) continue;
    const current = updates.get(stageId);
    if (!current || attempt >= current.attempt) {
      updates.set(stageId, { attempt, retryable: candidate.retryable !== false });
    }
  }
  return updates;
}

function selectPlanRevisions(input: ResearchRunProjectionInput): ResearchRunPlanRevision[] {
  const eventRevisions = revisionsByNumber(projectionEvents(input).flatMap(planRevisionsFromEvent));
  if (eventRevisions.length > 0) return eventRevisions;
  return revisionsByNumber(input.mission ? planFromMission(input.mission) : []);
}

export function selectResearchRunPlan(input: ResearchRunProjectionInput): ResearchRunPlanProjection {
  const revisions = selectPlanRevisions(input);
  const original = revisions[0] ?? null;
  const rawRevised = revisions.at(-1) ?? null;
  const retries = stageRetryUpdates(projectionEvents(input));
  const revised = rawRevised
    ? {
      ...rawRevised,
      stages: rawRevised.stages.map((stage) => {
        const retry = retries.get(stage.id);
        return retry
          ? { ...stage, attempt: Math.max(stage.attempt, retry.attempt), retryable: retry.retryable }
          : stage;
      }),
    }
    : null;
  const originalIds = new Set(original?.stages.map((stage) => stage.id) ?? []);
  const revisedIds = new Set(revised?.stages.map((stage) => stage.id) ?? []);
  const explicitSupersededBy = new Map<string, string>();
  for (const stage of revised?.stages ?? []) {
    for (const supersededId of stage.supersedes ?? []) {
      explicitSupersededBy.set(supersededId, stage.id);
    }
  }
  const supersededStageIds = (original?.stages ?? [])
    .filter((stage) => !revisedIds.has(stage.id) || explicitSupersededBy.has(stage.id))
    .map((stage) => stage.id);
  const markedOriginal = original
    ? {
      ...original,
      stages: original.stages.map((stage) => {
        const supersededBy = explicitSupersededBy.get(stage.id);
        return supersededStageIds.includes(stage.id)
          ? { ...stage, status: "superseded" as const, ...(supersededBy ? { supersededBy } : {}) }
          : stage;
      }),
    }
    : null;
  const terminal = input.state.run.status === "completed"
    || input.state.run.status === "failed"
    || input.state.run.status === "cancelled"
    || input.state.run.status === "expired";
  const activePhase = terminal
    ? undefined
    : input.state.activePhase ?? activePhaseFromEvents(projectionEvents(input));
  const activeStage = terminal
    ? undefined
    : revised?.stages.find((stage) => stage.status === "active")
      ?? (activePhase ? revised?.stages.find((stage) => stage.id === activePhase) : undefined);
  return {
    original: markedOriginal,
    revised,
    revisions,
    addedStageIds: (revised?.stages ?? []).filter((stage) => !originalIds.has(stage.id)).map((stage) => stage.id),
    supersededStageIds,
    retryableStageIds: (revised?.stages ?? []).filter((stage) => stage.retryable).map((stage) => stage.id),
    ...(activeStage ? { activeStageId: activeStage.id } : {}),
    hasRevision: revisions.length > 1 || Boolean(original && revised && revised.revision > original.revision),
  };
}

function activityForEvent(event: RunEventV1, index: number): ResearchRunActivityEntry {
  const data = eventData(event);
  const phase = textValue(data.phase, 80);
  const stageId = textValue(data.stageId ?? data.stage, 120);
  const explicitLabel = textValue(data.activity) ?? textValue(data.summary);
  const detail = textValue(data.activityDetail, MAX_DETAIL);
  let kind: ResearchRunActivityKind = "run";
  let label = explicitLabel ?? humanize(event.type);
  if (!explicitLabel) {
    if (event.type === "phase.started") {
      kind = "phase";
      label = `${humanize(phase ?? "phase")} started`;
    } else if (event.type === "phase.completed") {
      kind = "phase";
      label = `${humanize(phase ?? "phase")} completed`;
    } else if (event.type.startsWith("model-task.")) {
      kind = "task";
      label = `Model task ${humanize(event.type.slice("model-task.".length))}`;
    } else if (event.type === "checkpoint.required") {
      kind = "checkpoint";
      label = "Review requested";
    } else if (event.type === "artifact.registered") {
      kind = "artifact";
      label = "Artifact registered";
    } else if (event.type === "run.status" && typeof data.status === "string") {
      label = `Run status: ${humanize(data.status)}`;
    } else if (event.type === "run.failed") {
      label = "Run failed";
    } else if (event.type === "run.completed") {
      label = "Run completed";
    } else if (event.type === "run.cancelled") {
      label = "Run cancelled";
    } else if (event.type === "content.deleted") {
      label = "Run content deleted";
    }
  }
  if (event.type === "phase.started" || event.type === "phase.completed") kind = "phase";
  if (event.type.startsWith("model-task.")) kind = "task";
  if (event.type === "checkpoint.required") kind = "checkpoint";
  if (event.type === "artifact.registered") kind = "artifact";
  return {
    id: `event-${event.sequence}`,
    sequence: event.sequence || index + 1,
    at: event.at,
    kind,
    label,
    ...(detail ? { detail } : {}),
    ...(phase ? { phase } : {}),
    ...(stageId ? { stageId } : {}),
  };
}

function activityFromMission(mission: ResearchMission): ResearchRunActivityEntry[] {
  const entries: ResearchRunActivityEntry[] = [];
  for (const iteration of mission.iterations) {
    const baseSequence = iteration.number * 1_000;
    const at = iteration.startedAt ?? iteration.finishedAt ?? mission.updatedAt;
    entries.push({
      id: `iteration-${iteration.number}`,
      sequence: baseSequence,
      at,
      kind: "run",
      label: `Iteration ${iteration.number} ${iteration.status}`,
    });
    for (const [index, step] of (iteration.steps ?? []).entries()) {
      entries.push({
        id: `iteration-${iteration.number}-${step.id}`,
        sequence: baseSequence + index + 1,
        at,
        kind: "phase",
        label: `${humanize(step.type || step.id)} ${step.status}`,
        ...(textValue(step.detail, MAX_DETAIL) ? { detail: textValue(step.detail, MAX_DETAIL) } : {}),
        stageId: step.id,
      });
    }
    if (textValue(iteration.summary, MAX_DETAIL)) {
      entries.push({
        id: `iteration-${iteration.number}-summary`,
        sequence: baseSequence + 999,
        at: iteration.finishedAt ?? at,
        kind: "run",
        label: `Iteration ${iteration.number} summary`,
        detail: textValue(iteration.summary, MAX_DETAIL),
      });
    }
  }
  if (entries.length === 0) {
    entries.push({
      id: "mission-status",
      sequence: 1,
      at: mission.updatedAt,
      kind: "run",
      label: `Run status: ${humanize(mission.status)}`,
    });
  }
  return entries;
}

export function selectResearchRunActivity(input: ResearchRunProjectionInput): ResearchRunActivityProjection {
  const events = projectionEvents(input);
  let entries: ResearchRunActivityEntry[];
  if (events.length > 0) {
    entries = events.map(activityForEvent);
  } else if (input.mission) {
    entries = activityFromMission(input.mission);
  } else if (input.state.activity) {
    entries = [{
      id: "current-activity",
      sequence: input.state.lastEventSequence,
      at: input.state.lastEventAt,
      kind: "run",
      label: input.state.activity.label,
      ...(input.state.activity.detail ? { detail: input.state.activity.detail } : {}),
    }];
  } else {
    entries = [{
      id: "run-status",
      sequence: input.state.lastEventSequence,
      at: input.state.lastEventAt,
      kind: "run",
      label: `Run status: ${humanize(input.state.run.status)}`,
    }];
  }
  return {
    entries: entries
      .slice()
      .sort((left, right) => left.at.localeCompare(right.at) || left.sequence - right.sequence)
      .slice(-MAX_ITEMS),
  };
}

function sourceStatus(value: unknown): ResearchSourceRef["status"] | undefined {
  if (value === "candidate" || value === "used" || value === "conflicting" || value === "rejected") {
    return value;
  }
  return undefined;
}

function freshnessValue(value: unknown): ResearchRunEvidenceFreshness | undefined {
  return value === "fresh" || value === "aging" || value === "stale" || value === "unknown"
    ? value
    : undefined;
}

type ResearchRunEvidenceSourcePatch =
  & Pick<ResearchRunEvidenceSource, "id">
  & Partial<Omit<ResearchRunEvidenceSource, "id">>;

function sourceFromValue(value: unknown): ResearchRunEvidenceSourcePatch | undefined {
  if (!isRecord(value)) return undefined;
  const id = textValue(value.id ?? value.sourceId, 160);
  if (!id) return undefined;
  const title = textValue(value.title ?? value.name, MAX_TEXT);
  const status = sourceStatus(value.status);
  const fetchedAt = textValue(value.fetchedAt ?? value.retrievedAt ?? value.capturedAt, 64);
  const publishedAt = textValue(value.publishedAt, 64);
  const explicitFreshness = freshnessValue(value.freshness);
  return {
    id,
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(explicitFreshness ? { freshness: explicitFreshness } : {}),
    ...(textValue(value.sourceType ?? value.kind, 80) ? { sourceType: textValue(value.sourceType ?? value.kind, 80) } : {}),
    ...(safeUrl(value.url ?? value.canonicalUrl) ? { url: safeUrl(value.url ?? value.canonicalUrl) } : {}),
    ...(textValue(value.claim, MAX_DETAIL) ? { claim: textValue(value.claim, MAX_DETAIL) } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    ...(textValue(value.rejectionReason ?? value.reason, MAX_DETAIL) ? { rejectionReason: textValue(value.rejectionReason ?? value.reason, MAX_DETAIL) } : {}),
  };
}

function sourceFromMission(source: ResearchSourceRef): ResearchRunEvidenceSourcePatch {
  return {
    id: source.id,
    title: textValue(source.title) ?? `Source ${source.id}`,
    status: source.status,
    ...(textValue(source.sourceType, 80) ? { sourceType: textValue(source.sourceType, 80) } : {}),
    ...(safeUrl(source.url) ? { url: safeUrl(source.url) } : {}),
    ...(textValue(source.claim, MAX_DETAIL) ? { claim: textValue(source.claim, MAX_DETAIL) } : {}),
    ...(textValue(source.publishedAt, 64) ? { publishedAt: textValue(source.publishedAt, 64) } : {}),
    ...(source.status === "rejected" && textValue(source.note, MAX_DETAIL) ? { rejectionReason: textValue(source.note, MAX_DETAIL) } : {}),
  };
}

function sourceFromManifest(source: RunManifestSourceV1): ResearchRunEvidenceSourcePatch {
  if (source.kind === "context-pack") {
    return {
      id: source.id,
      digest: source.digest,
      availability: source.availability,
    };
  }
  return {
    id: source.id,
    contentDigest: source.contentDigest,
    snapshotDigest: source.snapshotDigest,
    url: source.canonicalUrl,
    fetchedAt: source.fetchedAt,
  };
}

function freshnessForTimestamp(timestamp: string | undefined, runUpdatedAt: string): ResearchRunEvidenceFreshness {
  if (!timestamp) return "unknown";
  const sourceTime = Date.parse(timestamp);
  const runTime = Date.parse(runUpdatedAt);
  if (!Number.isFinite(sourceTime) || !Number.isFinite(runTime)) return "unknown";
  const ageDays = Math.max(0, runTime - sourceTime) / 86_400_000;
  if (ageDays <= 30) return "fresh";
  if (ageDays <= 180) return "aging";
  return "stale";
}

function evidenceRecords(event: RunEventV1): Record<string, unknown>[] {
  const data = eventData(event);
  const records: Record<string, unknown>[] = [];
  if (isRecord(data.evidence)) records.push(data.evidence);
  records.push(data);
  return records;
}

function claimFromValue(
  value: unknown,
  event: RunEventV1,
  namespace: "evidence-claim" | "report-claim",
): ResearchRunEvidenceClaim | undefined {
  if (!isRecord(value)) return undefined;
  const text = textValue(value.text ?? value.claim ?? value.statement, MAX_DETAIL);
  if (!text) return undefined;
  const status = value.status === "supported" || value.status === "contradicted" || value.status === "rejected"
    ? value.status
    : "unresolved";
  const sourceIds = stringArray(value.sourceIds ?? value.sources ?? value.citationIds);
  const id = textValue(value.id ?? value.claimId, 160) ?? projectionFallbackId(namespace, event, {
    text,
    sourceIds: sourceIds.slice().sort(),
    status,
  });
  return {
    id,
    text,
    sourceIds,
    status,
  };
}

function contradictionFromValue(value: unknown, event: RunEventV1): ResearchRunContradiction | undefined {
  if (!isRecord(value)) return undefined;
  const claim = textValue(value.claim ?? value.text, MAX_DETAIL);
  const claimId = textValue(value.claimId, 160);
  const sourceIds = stringArray(value.sourceIds ?? value.sources);
  if (!claim && !claimId && sourceIds.length === 0) return undefined;
  const detail = textValue(value.detail ?? value.reason, MAX_DETAIL);
  const id = textValue(value.id ?? value.contradictionId, 160) ?? projectionFallbackId(
    "evidence-contradiction",
    event,
    {
      claim,
      claimId,
      sourceIds: sourceIds.slice().sort(),
      detail,
    },
  );
  return {
    id,
    ...(claimId ? { claimId } : {}),
    ...(claim ? { claim } : {}),
    sourceIds,
    ...(detail ? { detail } : {}),
  };
}

function rejectedFromValue(value: unknown, event: RunEventV1): ResearchRunRejectedEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const sourceId = textValue(value.sourceId ?? value.id, 160);
  const title = textValue(value.title ?? value.name ?? value.claim, MAX_TEXT);
  if (!sourceId && !title) return undefined;
  const reason = textValue(value.reason ?? value.rejectionReason ?? value.detail, MAX_DETAIL);
  const id = sourceId ?? projectionFallbackId("evidence-rejected", event, {
    title,
    reason,
  });
  return {
    id,
    title: title ?? `Evidence ${sourceId}`,
    ...(sourceId ? { sourceId } : {}),
    ...(reason ? { reason } : {}),
  };
}

function evidenceFromInput(input: ResearchRunProjectionInput): {
  sources: ResearchRunEvidenceSource[];
  claims: ResearchRunEvidenceClaim[];
  contradictions: ResearchRunContradiction[];
  rejected: ResearchRunRejectedEvidence[];
} {
  const sourceMap = new Map<string, ResearchRunEvidenceSourcePatch>();
  const claimMap = new Map<string, ResearchRunEvidenceClaim>();
  const contradictionMap = new Map<string, ResearchRunContradiction>();
  const rejectedMap = new Map<string, ResearchRunRejectedEvidence>();
  const addSource = (source: ResearchRunEvidenceSourcePatch | undefined) => {
    if (!source) return;
    const current = sourceMap.get(source.id);
    sourceMap.set(source.id, current ? { ...current, ...source } : source);
  };
  const addClaim = (claim: ResearchRunEvidenceClaim | undefined) => {
    if (!claim) return;
    const current = claimMap.get(claim.id);
    claimMap.set(claim.id, current
      ? { ...current, ...claim, sourceIds: [...new Set([...current.sourceIds, ...claim.sourceIds])] }
      : claim);
  };
  for (const event of projectionEvents(input)) {
    for (const record of evidenceRecords(event)) {
      const rawSources = record.sources;
      if (Array.isArray(rawSources)) {
        for (const value of rawSources.slice(0, MAX_ITEMS)) addSource(sourceFromValue(value));
      }
      addSource(sourceFromValue(record.source));
      const reportClaims = isRecord(record.report) ? record.report.claims : undefined;
      const hasEvidenceClaims = Array.isArray(record.claims);
      const rawClaims = hasEvidenceClaims
        ? record.claims as unknown[]
        : Array.isArray(reportClaims) ? reportClaims : [];
      const claimNamespace = hasEvidenceClaims ? "evidence-claim" : "report-claim";
      for (const value of rawClaims.slice(0, MAX_ITEMS)) {
        addClaim(claimFromValue(value, event, claimNamespace));
      }
      for (const value of (Array.isArray(record.contradictions) ? record.contradictions : []).slice(0, MAX_ITEMS)) {
        const contradiction = contradictionFromValue(value, event);
        if (contradiction) contradictionMap.set(contradiction.id, contradiction);
      }
      const rawRejected = Array.isArray(record.rejected)
        ? record.rejected
        : Array.isArray(record.rejectedEvidence) ? record.rejectedEvidence : [];
      for (const value of rawRejected.slice(0, MAX_ITEMS)) {
        const rejected = rejectedFromValue(value, event);
        if (rejected) rejectedMap.set(rejected.id, rejected);
      }
    }
  }
  for (const source of input.state.run.artifactManifest?.sources ?? []) {
    addSource(sourceFromManifest(source));
  }
  for (const source of input.mission?.sources ?? []) {
    const current = sourceMap.get(source.id);
    const legacy = sourceFromMission(source);
    sourceMap.set(source.id, current ? { ...legacy, ...current } : legacy);
  }
  const sources = [...sourceMap.values()].map((source): ResearchRunEvidenceSource => ({
    ...source,
    title: source.title ?? `Source ${source.id}`,
    status: source.status ?? "candidate",
    freshness: source.freshness ?? freshnessForTimestamp(source.fetchedAt, input.state.run.updatedAt),
  }));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const source of sources) {
    if (source.claim) {
      const current = [...claimMap.values()].find((claim) => claim.text === source.claim);
      const id = current?.id ?? `claim-${source.id}`;
      addClaim(current
        ? { ...current, sourceIds: [...new Set([...current.sourceIds, source.id])] }
        : {
          id,
          text: source.claim,
          sourceIds: [source.id],
          status: source.status === "conflicting"
            ? "contradicted"
            : source.status === "rejected" ? "rejected" : source.status === "used" ? "supported" : "unresolved",
        });
    }
    if (source.status === "rejected") {
      const rejected: ResearchRunRejectedEvidence = {
        id: source.id,
        title: source.title,
        sourceId: source.id,
        ...(source.rejectionReason ? { reason: source.rejectionReason } : {}),
      };
      rejectedMap.set(source.id, rejected);
    }
  }
  for (const claim of claimMap.values()) {
    const sourceStatuses = claim.sourceIds.map((id) => sourceById.get(id)?.status);
    const status = sourceStatuses.includes("conflicting")
      ? "contradicted"
      : sourceStatuses.includes("rejected")
        ? "rejected"
        : sourceStatuses.includes("used")
          ? "supported"
          : claim.status;
    claimMap.set(claim.id, { ...claim, status });
    if (status === "contradicted") {
      const alreadyRecorded = [...contradictionMap.values()].some(
        (contradiction) => contradiction.claimId === claim.id,
      );
      const id = `contradiction-${claim.id}`;
      if (!alreadyRecorded) contradictionMap.set(id, { id, claimId: claim.id, sourceIds: claim.sourceIds, claim: claim.text });
    }
  }
  return {
    sources,
    claims: [...claimMap.values()],
    contradictions: [...contradictionMap.values()],
    rejected: [...rejectedMap.values()],
  };
}

export function selectResearchRunEvidence(input: ResearchRunProjectionInput): ResearchRunEvidenceProjection {
  const collected = evidenceFromInput(input);
  const observedCounts: ResearchRunEvidenceCounts = {};
  for (const event of projectionEvents(input)) {
    for (const key of ["sources", "reviewed", "retained", "rejected", "cited", "artifacts"] as const) {
      const count = nonNegativeInteger(event.data[key]);
      if (count !== undefined) observedCounts[key] = count;
    }
    if (
      event.type === "artifact.registered"
      && nonNegativeInteger(event.data.artifacts) === undefined
      && nonNegativeInteger(event.data.artifactCount) === undefined
    ) {
      observedCounts.artifacts = (observedCounts.artifacts ?? 0) + 1;
    }
    const artifactCount = nonNegativeInteger(event.data.artifactCount);
    if (artifactCount !== undefined) observedCounts.artifacts = artifactCount;
  }
  const evidenceCounts: ResearchRunEvidenceCounts = input.eventHistory === undefined
    ? { ...observedCounts, ...input.state.evidence }
    : { ...input.state.evidence, ...observedCounts };
  if (
    input.eventHistory !== undefined
    && observedCounts.artifacts !== undefined
    && input.state.evidence.artifacts !== undefined
  ) {
    evidenceCounts.artifacts = Math.max(
      observedCounts.artifacts,
      input.state.evidence.artifacts,
    );
  }
  const counts: ResearchRunEvidenceCounts = {
    ...(evidenceCounts.sources !== undefined ? { sources: evidenceCounts.sources } : collected.sources.length > 0 ? { sources: collected.sources.length } : {}),
    ...(evidenceCounts.reviewed !== undefined ? { reviewed: evidenceCounts.reviewed } : {}),
    ...(evidenceCounts.retained !== undefined
      ? { retained: evidenceCounts.retained }
      : collected.sources.length > 0 ? { retained: collected.sources.filter((source) => source.status === "used").length } : {}),
    ...(evidenceCounts.rejected !== undefined
      ? { rejected: evidenceCounts.rejected }
      : collected.rejected.length > 0 ? { rejected: collected.rejected.length } : {}),
    ...(evidenceCounts.cited !== undefined ? { cited: evidenceCounts.cited } : {}),
    ...(evidenceCounts.artifacts !== undefined ? { artifacts: evidenceCounts.artifacts } : {}),
  };
  const freshness: Record<ResearchRunEvidenceFreshness, number> = {
    fresh: 0,
    aging: 0,
    stale: 0,
    unknown: 0,
  };
  for (const source of collected.sources) freshness[source.freshness] += 1;
  return { ...collected, counts, freshness };
}

function outlineStatus(value: unknown): ResearchRunReportOutlineStatus {
  if (value === "active" || value === "in_progress" || value === "running") return "active";
  if (value === "complete" || value === "completed" || value === "ready") return "complete";
  if (value === "blocked" || value === "failed") return "blocked";
  return "pending";
}

function outlineFromValue(value: unknown, event: RunEventV1): ResearchRunReportOutlineItem | undefined {
  if (!isRecord(value)) return undefined;
  const title = textValue(value.title ?? value.label ?? value.name, MAX_TEXT);
  if (!title) return undefined;
  const depth = nonNegativeInteger(value.depth) ?? 0;
  const status = outlineStatus(value.status ?? value.state);
  const detail = textValue(value.detail ?? value.summary, MAX_DETAIL);
  const id = textValue(value.id ?? value.key, 160) ?? projectionFallbackId("report-section", event, {
    title,
    status,
    depth: Math.min(depth, 8),
    detail,
  });
  return {
    id,
    title,
    status,
    depth: Math.min(depth, 8),
    ...(detail ? { detail } : {}),
  };
}

function artifactFromValue(
  value: unknown,
  event?: RunEventV1,
): ResearchRunReportArtifact | undefined {
  if (!isRecord(value)) return undefined;
  const explicitId = textValue(value.id ?? value.key ?? value.artifactId, 160);
  const explicitTitle = textValue(value.title ?? value.name, MAX_TEXT);
  if (!explicitId && !explicitTitle) return undefined;
  const rawStatus = value.status ?? value.state;
  const status = rawStatus === "published" || rawStatus === "ready" || rawStatus === "rejected" || rawStatus === "working"
    ? rawStatus
    : "ready";
  const kind = textValue(value.kind, 80);
  const contentSync = textValue(value.contentSync, 80);
  const at = textValue(value.at ?? value.createdAt ?? value.updatedAt, 64);
  const id = explicitId ?? (event
    ? projectionFallbackId("report-artifact", event, {
      title: explicitTitle,
      kind,
      status,
      contentSync,
      at,
    })
    : undefined);
  if (!id) return undefined;
  return {
    id,
    title: explicitTitle ?? `Artifact ${id}`,
    ...(kind ? { kind } : {}),
    status,
    ...(contentSync ? { contentSync } : {}),
    ...(at ? { at } : {}),
  };
}

function artifactFromMission(artifact: ResearchArtifactRef): ResearchRunReportArtifact {
  return {
    id: artifact.key,
    title: artifact.title,
    kind: artifact.kind,
    status: artifact.state === "published" ? "published" : artifact.state,
    at: artifact.updatedAt,
  };
}

function exportStatus(value: unknown): ResearchRunExportStatus | undefined {
  if (value === "pending" || value === "not_started") return "not_started";
  if (value === "draft" || value === "in_progress" || value === "assembling") return "draft";
  if (value === "ready") return "ready";
  if (value === "exported" || value === "published" || value === "completed") return "exported";
  if (value === "failed" || value === "error") return "failed";
  return undefined;
}

function reportClaimsFromInput(input: ResearchRunProjectionInput): ResearchRunReportClaim[] {
  const evidence = selectResearchRunEvidence(input);
  const claims = new Map<string, ResearchRunReportClaim>(
    evidence.claims.map((claim) => [claim.id, { ...claim, citationIds: claim.sourceIds }]),
  );
  for (const event of projectionEvents(input)) {
    for (const record of evidenceRecords(event)) {
      const reportClaims = isRecord(record.report) ? record.report.claims : undefined;
      const hasEvidenceClaims = Array.isArray(record.claims);
      const rawClaims = hasEvidenceClaims
        ? record.claims as unknown[]
        : Array.isArray(reportClaims) ? reportClaims : [];
      const claimNamespace = hasEvidenceClaims ? "evidence-claim" : "report-claim";
      for (const value of rawClaims.slice(0, MAX_ITEMS)) {
        const claim = claimFromValue(value, event, claimNamespace);
        if (!claim) continue;
        const current = claims.get(claim.id);
        claims.set(claim.id, {
          ...(current ?? claim),
          ...claim,
          status: claim.status === "unresolved" && current ? current.status : claim.status,
          citationIds: [...new Set([...(current?.citationIds ?? []), ...claim.sourceIds])],
        });
      }
    }
  }
  return [...claims.values()];
}

export function selectResearchRunReport(input: ResearchRunProjectionInput): ResearchRunReportProjection {
  const outlineById = new Map<string, ResearchRunReportOutlineItem>();
  const artifactsById = new Map<string, ResearchRunReportArtifact>();
  let selectedExport: { status: ResearchRunExportStatus; detail?: string; at?: string } | undefined;
  for (const event of projectionEvents(input)) {
    for (const record of evidenceRecords(event)) {
      const report = isRecord(record.report) ? record.report : record;
      const rawOutline = report.outline ?? report.sections;
      if (Array.isArray(rawOutline)) {
        for (const value of rawOutline.slice(0, MAX_ITEMS)) {
          const item = outlineFromValue(value, event);
          if (item) outlineById.set(item.id, item);
        }
      }
      const rawArtifacts = Array.isArray(report.artifacts) ? report.artifacts : [];
      for (const value of rawArtifacts.slice(0, MAX_ITEMS)) {
        const artifact = artifactFromValue(value, event);
        if (artifact) artifactsById.set(artifact.id, artifact);
      }
      const candidateExport = exportStatus(
        report.exportStatus
          ?? (isRecord(report.export) ? report.export.status : report.export),
      );
      if (candidateExport) {
        selectedExport = {
          status: candidateExport,
          ...(textValue(isRecord(report.export) ? report.export.detail : undefined, MAX_DETAIL) ? { detail: textValue(isRecord(report.export) ? report.export.detail : undefined, MAX_DETAIL) } : {}),
          ...(textValue(isRecord(report.export) ? report.export.at : report.exportedAt, 64) ? { at: textValue(isRecord(report.export) ? report.export.at : report.exportedAt, 64) } : {}),
        };
      }
    }
    const artifact = artifactFromValue(eventData(event).artifact, event);
    if (artifact) artifactsById.set(artifact.id, artifact);
  }
  for (const artifact of input.state.run.artifactManifest?.artifacts ?? []) {
    const parsed = artifactFromValue({
      ...artifact,
      status: "ready",
    });
    if (!parsed) continue;
    const current = artifactsById.get(parsed.id);
    artifactsById.set(parsed.id, current
      ? { ...current, ...parsed, status: current.status }
      : parsed);
  }
  for (const artifact of input.mission?.artifacts ?? []) {
    const parsed = artifactFromMission(artifact);
    if (!artifactsById.has(parsed.id)) artifactsById.set(parsed.id, parsed);
  }
  const latestIteration = input.mission?.iterations.at(-1);
  if (outlineById.size === 0 && latestIteration?.summary) {
    outlineById.set("findings", {
      id: "findings",
      title: "Findings",
      status: input.mission?.status === "completed" ? "complete" : "active",
      depth: 0,
      detail: textValue(latestIteration.summary, MAX_DETAIL),
    });
  }
  if (!selectedExport) {
    const hasPublished = [...artifactsById.values()].some((artifact) => artifact.status === "published");
    selectedExport = { status: hasPublished ? "exported" : artifactsById.size > 0 ? "ready" : "not_started" };
  }
  return {
    outline: [...outlineById.values()],
    claims: reportClaimsFromInput(input),
    artifacts: [...artifactsById.values()],
    exportStatus: selectedExport.status,
    ...(selectedExport.detail ? { exportDetail: selectedExport.detail } : {}),
    ...(selectedExport.at ? { exportedAt: selectedExport.at } : {}),
  };
}

export function selectResearchRunProjections(input: ResearchRunProjectionInput): ResearchRunProjections {
  return {
    runId: input.state.run.id,
    plan: selectResearchRunPlan(input),
    activity: selectResearchRunActivity(input),
    evidence: selectResearchRunEvidence(input),
    report: selectResearchRunReport(input),
    sync: input.state.sync,
  };
}

const MISSION_STATUS: Record<ResearchMissionStatus, ResearchRunStatusV1> = {
  queued: "queued",
  planning: "scoping",
  running: "gathering_public_sources",
  checkpoint: "awaiting_checkpoint",
  paused: "waiting_for_executor",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  archived: "completed",
};

/**
 * Compatibility bridge for the current mission endpoint. It intentionally
 * creates reducer state first; when the run gateway supplies a real state, the
 * same selectors receive that state and the mission fallback disappears.
 */
export function researchMissionToRunProjectionInput(mission: ResearchMission): ResearchRunProjectionInput {
  const run = {
    schema: "opencoven.research-run/v1" as const,
    id: mission.id,
    acceptedTopic: { question: mission.intent, editedByUser: false },
    execution: {
      location: "local" as const,
      modelExecution: "cave-device" as const,
      modelBinding: {
        familiarId: mission.familiarId,
        selection: mission.model ? "pinned" as const : "resolve-at-run-start" as const,
        ...(mission.model ? { model: mission.model } : {}),
      },
      strategy: "single-agent" as const,
    },
    privacy: {
      remoteQueries: false,
      remoteContent: false,
      artifactContentSync: false,
      retention: "7-days" as const,
      allowMemoryPromotion: false as const,
    },
    bounds: mission.bounds,
    status: MISSION_STATUS[mission.status],
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    nextEventSequence: 1,
  };
  return { state: createResearchRunEventState(run), mission };
}
