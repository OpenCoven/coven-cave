import { existsSync, watch, type FSWatcher } from "node:fs";
import { canonicalJson, digestProtocolObject } from "../research-protocol/digest.ts";
import {
  parseResearchRunV1,
  type ResearchRunStatusV1,
  type ResearchRunV1,
  type RunEventV1,
} from "../research-protocol/research-run.ts";
import type { ResearchMission } from "../research-missions.ts";
import {
  isValidResearchMissionId,
  loadResearchMission,
  researchMissionWorkspacePath,
} from "./research-mission-store.ts";
import {
  appendResearchRunEventsWithinMissionLock,
  loadResearchRunEventLog,
  missionIdForResearchRunId,
  researchRunEventLogRoot,
  researchRunIdForMissionId,
  type ResearchRunEventLog,
  type ResearchRunObservedProjection,
} from "./research-run-gateway-store.ts";
import { withResearchMissionActionLock } from "./research-mission-lock.ts";

const PHASES = ["scope", "challenge", "synthesize", "control"] as const;
type ResearchRunPhase = (typeof PHASES)[number];

export class ResearchRunGatewayError extends Error {
  readonly code: "not_found" | "invalid" | "integrity" | "cursor";
  readonly status: 404 | 409 | 500;

  constructor(
    code: ResearchRunGatewayError["code"],
    message: string,
    status: ResearchRunGatewayError["status"],
  ) {
    super(message);
    this.name = "ResearchRunGatewayError";
    this.code = code;
    this.status = status;
  }
}

export type ResearchRunGatewaySnapshot = {
  run: ResearchRunV1;
  lastEventSequence: number;
  nextEventSequence: number;
};

export type ResearchRunGatewayReplay = ResearchRunGatewaySnapshot & {
  events: RunEventV1[];
  afterSequence: number;
  hasMore: boolean;
};

export type ResearchRunWatcherDeps = {
  existsSync: (path: string) => boolean;
  watch: (
    path: string,
    options: { persistent: false },
    listener: (event: string, filename: string | Buffer | null) => void,
  ) => FSWatcher;
};

const DEFAULT_WATCHER_DEPS: ResearchRunWatcherDeps = {
  existsSync,
  watch: (path, options, listener) => watch(path, options, listener),
};

export type ResearchRunSyncDeps = {
  loadMission: typeof loadResearchMission;
  loadEventLog: typeof loadResearchRunEventLog;
  appendEventsWithinMissionLock: typeof appendResearchRunEventsWithinMissionLock;
};

const DEFAULT_SYNC_DEPS: ResearchRunSyncDeps = {
  loadMission: loadResearchMission,
  loadEventLog: loadResearchRunEventLog,
  appendEventsWithinMissionLock: appendResearchRunEventsWithinMissionLock,
};

function canonicalTimestamp(value: string, fallback: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function latestTimestamp(...values: string[]): string {
  const parsed = values
    .map((value) => ({ value: canonicalTimestamp(value, ""), time: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.time));
  if (parsed.length === 0) return "1970-01-01T00:00:00.000Z";
  return parsed.reduce((latest, candidate) => candidate.time > latest.time ? candidate : latest).value;
}

function activePhase(mission: ResearchMission): ResearchRunPhase | undefined {
  const steps = mission.iterations.at(-1)?.steps ?? [];
  const active = steps.find((step) => step.status === "running");
  const candidate = `${active?.type ?? ""} ${active?.id ?? ""}`.toLowerCase();
  return PHASES.find((phase) => candidate.includes(phase));
}

function canonicalStatusForMission(mission: ResearchMission): {
  status: ResearchRunStatusV1;
  waitingReason?: "checkpoint";
  waitingForPhase?: ResearchRunPhase;
  failure?: { code: string; message: string; retryable: boolean };
} {
  switch (mission.status) {
    case "queued":
      return { status: "queued" };
    case "planning":
      return { status: "scoping" };
    case "running": {
      const phase = activePhase(mission);
      if (phase === "scope") return { status: "scoping" };
      if (phase === "challenge") return { status: "challenging" };
      if (phase === "control") return { status: "controlling" };
      return { status: "synthesizing" };
    }
    case "checkpoint":
    case "paused":
      return { status: "awaiting_checkpoint", waitingReason: "checkpoint" };
    case "completed":
      return { status: "completed" };
    case "failed":
      return {
        status: "failed",
        failure: {
          code: "research_mission_failed",
          message: "The persisted research mission reported a failure.",
          retryable: false,
        },
      };
    case "cancelled":
      return { status: "cancelled" };
    case "archived": {
      if (mission.archivedFrom === "completed") return { status: "completed" };
      if (mission.archivedFrom === "failed") {
        return {
          status: "failed",
          failure: {
            code: "research_mission_failed",
            message: "The persisted research mission reported a failure.",
            retryable: false,
          },
        };
      }
      return { status: "cancelled" };
    }
  }
}

export async function subscribeBeforeInitialResearchRunRead<T>(
  subscribe: (onChange: () => void) => () => void,
  onChange: () => void,
  initialRead: () => Promise<T>,
): Promise<{ value: T; activate: () => void; stopWatching: () => void }> {
  let active = false;
  let pending = false;
  const notify = () => {
    if (active) onChange();
    else pending = true;
  };
  const stopWatching = subscribe(notify);
  try {
    const value = await initialRead();
    return {
      value,
      activate: () => {
        if (active) return;
        active = true;
        if (pending) {
          pending = false;
          onChange();
        }
      },
      stopWatching,
    };
  } catch (error) {
    stopWatching();
    throw error;
  }
}

function safeModelName(value: string | undefined): string | undefined {
  if (!value || value.length > 200 || value.includes("\0")) return undefined;
  return value;
}

function finalManifest(runId: string, mission: ResearchMission, createdAt: string, updatedAt: string) {
  const candidate = {
    schema: "opencoven.run-manifest/v1" as const,
    id: `manifest_${mission.id}`,
    runId,
    digest: "",
    revision: 1,
    state: "final" as const,
    createdAt,
    finalizedAt: updatedAt,
    // The legacy mission store has no canonical Context Pack or content
    // digests. An empty metadata-only manifest is safer than inventing source
    // or artifact digests and still satisfies the v1 terminal-run contract.
    sources: [],
    artifacts: [],
    modelExecutions: [],
    usage: {
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      completeness: "unreported" as const,
    },
    retention: {
      policy: "run-only" as const,
      effectivePolicy: "run-only" as const,
      status: "active" as const,
      contentExpiresAt: null,
      updatedAt,
    },
    deletion: { status: "not_scheduled" as const },
  };
  return { ...candidate, digest: digestProtocolObject(candidate) };
}

/**
 * Convert the legacy, durable mission record into the canonical v1 run
 * envelope. This adapter deliberately omits mission prompt/source/artifact
 * bodies from events; the owner-only snapshot carries only the protocol's
 * required accepted question and metadata-only terminal manifest.
 */
export function researchMissionToCanonicalRun(
  mission: ResearchMission,
  nextEventSequence: number,
): ResearchRunV1 {
  const createdAt = canonicalTimestamp(mission.createdAt, "1970-01-01T00:00:00.000Z");
  const updatedAt = latestTimestamp(createdAt, mission.updatedAt, mission.finishedAt ?? createdAt);
  const status = canonicalStatusForMission(mission);
  const model = safeModelName(mission.model);
  const run: Record<string, unknown> = {
    schema: "opencoven.research-run/v1",
    id: researchRunIdForMissionId(mission.id),
    acceptedTopic: {
      question: mission.intent,
      // The legacy mission record does not distinguish topic editing from
      // launch mode selection, so do not claim that it was edited.
      editedByUser: false,
    },
    execution: {
      location: "local",
      modelExecution: "cave-device",
      modelBinding: {
        familiarId: mission.familiarId,
        selection: model ? "pinned" : "resolve-at-run-start",
        ...(model ? { model } : {}),
      },
      strategy: "single-agent",
    },
    privacy: {
      // Mission v1 predates the canonical consent fields. Unknown consent is
      // never upgraded to permission at this gateway boundary.
      remoteQueries: false,
      remoteContent: false,
      artifactContentSync: false,
      retention: "run-only",
      allowMemoryPromotion: false,
    },
    bounds: {
      wallClockMinutes: mission.bounds.wallClockMinutes,
      maxIterations: mission.bounds.maxIterations,
      sourceTarget: mission.bounds.sourceTarget,
      ...(mission.bounds.maxSpendUsd !== undefined ? { maxSpendUsd: mission.bounds.maxSpendUsd } : {}),
      checkpointEvery: mission.bounds.checkpointEvery,
      stopWhenCostUnavailable: mission.bounds.stopWhenCostUnavailable,
    },
    status: status.status,
    ...(status.waitingReason ? { waitingReason: status.waitingReason } : {}),
    ...(status.waitingForPhase ? { waitingForPhase: status.waitingForPhase } : {}),
    createdAt,
    updatedAt,
    nextEventSequence,
    // Safe, non-content compatibility metadata for projections that still
    // need to explain why a legacy status was mapped to a v1 status.
    sourceOfTruth: "research-mission",
    legacyMissionStatus: mission.status,
    ...(status.failure ? { failure: status.failure } : {}),
  };
  if (status.status === "completed" || status.status === "failed" || status.status === "cancelled") {
    run.artifactManifest = finalManifest(
      researchRunIdForMissionId(mission.id),
      mission,
      createdAt,
      updatedAt,
    );
  }
  const parsed = parseResearchRunV1(run);
  if (!parsed.ok) {
    throw new ResearchRunGatewayError(
      "integrity",
      `canonical Research Run projection failed validation: ${parsed.error.message}`,
      500,
    );
  }
  return parsed.value;
}

function observedProjection(
  mission: ResearchMission,
  run: ResearchRunV1,
): ResearchRunObservedProjection {
  return {
    status: run.status,
    missionUpdatedAt: run.updatedAt,
    iterationCount: mission.iterations.length,
    sourceCount: mission.sources.length,
    artifactCount: mission.artifacts.length,
  };
}

function eventData(
  mission: ResearchMission,
  run: ResearchRunV1,
): Record<string, unknown> {
  return {
    status: run.status,
    sources: mission.sources.length,
    artifacts: mission.artifacts.length,
    iterations: mission.iterations.length,
    ...(run.waitingReason ? { waitingReason: run.waitingReason } : {}),
    ...(run.waitingForPhase ? { waitingForPhase: run.waitingForPhase } : {}),
  };
}

function eventForObservedTransition(
  mission: ResearchMission,
  run: ResearchRunV1,
  sequence: number,
  at: string,
): RunEventV1 {
  const data = eventData(mission, run);
  if (run.status === "completed") {
    return { schema: "opencoven.run-event/v1", runId: run.id, sequence, type: "run.completed", at, data };
  }
  if (run.status === "cancelled") {
    return { schema: "opencoven.run-event/v1", runId: run.id, sequence, type: "run.cancelled", at, data };
  }
  if (run.status === "failed") {
    return {
      schema: "opencoven.run-event/v1",
      runId: run.id,
      sequence,
      type: "run.failed",
      at,
      data: { ...data, failure: run.failure },
    };
  }
  return { schema: "opencoven.run-event/v1", runId: run.id, sequence, type: "run.status", at, data };
}

export async function syncObservedMission(
  missionId: string,
  deps: ResearchRunSyncDeps = DEFAULT_SYNC_DEPS,
): Promise<{ mission: ResearchMission; log: ResearchRunEventLog } | null> {
  return withResearchMissionActionLock(missionId, async () => {
    const mission = await deps.loadMission(missionId);
    if (!mission) return null;
    const runId = researchRunIdForMissionId(mission.id);
    const existing = await deps.loadEventLog(runId);
    const initialSequence = (existing?.events.at(-1)?.sequence ?? 0) + 1;
    const projectedRun = researchMissionToCanonicalRun(mission, initialSequence);
    const projection = observedProjection(mission, projectedRun);

    if (!existing) {
      const created: RunEventV1 = {
        schema: "opencoven.run-event/v1",
        runId,
        sequence: 1,
        type: "run.created",
        at: projectedRun.createdAt,
        // No lifecycle status is asserted here: this is the gateway's durable
        // bootstrap marker, not a fabricated executor event.
        data: {},
      };
      const transitions = projectedRun.status === "queued"
        ? [created]
        : [created, eventForObservedTransition(mission, projectedRun, 2, projectedRun.updatedAt)];
      const log = await deps.appendEventsWithinMissionLock(runId, transitions, projection);
      return { mission, log };
    }

    if (!existing.projection) {
      throw new ResearchRunGatewayError(
        "integrity",
        "research Run event log has no observed mission projection",
        500,
      );
    }
    if (canonicalJson(existing.projection) === canonicalJson(projection)) {
      return { mission, log: existing };
    }

    const nextSequence = existing.events.at(-1)!.sequence + 1;
    const transition = eventForObservedTransition(
      mission,
      projectedRun,
      nextSequence,
      projectedRun.updatedAt,
    );
    const log = await deps.appendEventsWithinMissionLock(runId, [transition], projection);
    return { mission, log };
  });
}

function replayFromLog(
  log: ResearchRunEventLog,
  afterSequence: number,
  limit: number,
): { events: RunEventV1[]; hasMore: boolean } {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new ResearchRunGatewayError("invalid", "afterSeq must be a safe integer >= 0", 409);
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new ResearchRunGatewayError("invalid", "limit must be between 1 and 500", 409);
  }
  const last = log.events.at(-1)?.sequence ?? 0;
  if (afterSequence > last) {
    throw new ResearchRunGatewayError("cursor", "requested event sequence is ahead of the durable ledger", 409);
  }
  const events = log.events.filter((event) => event.sequence > afterSequence).slice(0, limit);
  return {
    events,
    hasMore: events.at(-1)?.sequence !== undefined && events.at(-1)!.sequence < last,
  };
}

export function missionIdForResearchRunPath(rawId: string): string | null {
  if (rawId.startsWith("run_")) {
    try {
      const missionId = missionIdForResearchRunId(rawId);
      return isValidResearchMissionId(missionId) ? missionId : null;
    } catch {
      return null;
    }
  }
  return isValidResearchMissionId(rawId) ? rawId : null;
}

export async function loadResearchRunGateway(
  missionId: string,
): Promise<ResearchRunGatewaySnapshot | null> {
  if (!isValidResearchMissionId(missionId)) {
    throw new ResearchRunGatewayError("invalid", "invalid research mission id", 409);
  }
  const synced = await syncObservedMission(missionId);
  if (!synced) return null;
  const { mission, log } = synced;
  const lastEventSequence = log.events.at(-1)?.sequence ?? 0;
  return {
    run: researchMissionToCanonicalRun(mission, lastEventSequence + 1),
    lastEventSequence,
    nextEventSequence: lastEventSequence + 1,
  };
}

export async function replayResearchRunGateway(
  missionId: string,
  afterSequence: number,
  limit: number,
): Promise<ResearchRunGatewayReplay | null> {
  if (!isValidResearchMissionId(missionId)) {
    throw new ResearchRunGatewayError("invalid", "invalid research mission id", 409);
  }
  const synced = await syncObservedMission(missionId);
  if (!synced) return null;
  const { mission, log } = synced;
  const replay = replayFromLog(log, afterSequence, limit);
  const lastEventSequence = log.events.at(-1)?.sequence ?? 0;
  return {
    run: researchMissionToCanonicalRun(mission, lastEventSequence + 1),
    lastEventSequence,
    nextEventSequence: lastEventSequence + 1,
    events: replay.events,
    afterSequence,
    hasMore: replay.hasMore,
  };
}

/**
 * Watch only the mission source and this run's durable ledger. The callback is
 * an invalidation hint; every caller must reread and validate the authoritative
 * files before sending anything to a client.
 */
export function watchResearchRunSources(
  missionId: string,
  onChange: () => void,
  onFailure: (error: unknown) => void,
  deps: ResearchRunWatcherDeps = DEFAULT_WATCHER_DEPS,
): () => void {
  const runId = researchRunIdForMissionId(missionId);
  const specs = [
    {
      dir: researchMissionWorkspacePath(missionId),
      name: "mission.json",
    },
    {
      dir: researchRunEventLogRoot(),
      name: `${runId}.json`,
    },
  ];
  const watchers: FSWatcher[] = [];
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (stopped) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(onChange, 40);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (debounce) clearTimeout(debounce);
    debounce = null;
    for (const watcher of watchers) {
      watcher.removeListener("error", fail);
      watcher.close();
    }
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stop();
    onFailure(error);
  };
  for (const spec of specs) {
    if (!deps.existsSync(spec.dir)) continue;
    try {
      const watcher = deps.watch(
        /* turbopackIgnore: true */ spec.dir,
        { persistent: false },
        (_event, filename) => {
          if (filename && filename.toString() !== spec.name) return;
          schedule();
        },
      );
      watchers.push(watcher);
      watcher.on("error", fail);
    } catch (error) {
      stop();
      throw error;
    }
  }
  return stop;
}
