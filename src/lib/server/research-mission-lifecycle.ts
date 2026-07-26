import type {
  CreateResearchMissionInput,
  ResearchMission,
} from "../research-missions.ts";
import {
  researchArtifactKindForMode,
  STANDARD_RESEARCH_ARTIFACTS,
} from "../research-missions.ts";
import type { FlowRunRecord } from "../flows.ts";

export type ResearchFlowStartResult = {
  ok: boolean;
  executor?: "session" | "travel-queue";
  sessionId?: string;
  run?: FlowRunRecord;
  queued?: boolean;
  unavailable?: boolean;
  error?: string;
};

function missionTitle(input: CreateResearchMissionInput): string {
  const explicit = input.title?.trim();
  if (explicit) return explicit.slice(0, 160);
  const intent = input.intent.trim().replace(/\s+/g, " ");
  return intent.length <= 80 ? intent : `${intent.slice(0, 77)}…`;
}

/** Create the durable pre-launch mission record. */
export function createMissionRecord(
  input: CreateResearchMissionInput,
  id: string,
  now: Date,
): ResearchMission {
  const timestamp = now.toISOString();
  const kind = researchArtifactKindForMode(input.mode);
  return {
    version: 1,
    id,
    familiarId: input.familiarId,
    title: missionTitle(input),
    intent: input.intent.trim(),
    mode: input.mode,
    modeSource: input.modeSource,
    deliverable: input.deliverable,
    ...(input.audience?.trim() ? { audience: input.audience.trim() } : {}),
    ...(input.projectRoot?.trim() ? { projectRoot: input.projectRoot.trim() } : {}),
    constraints: (input.constraints ?? []).map((item) => item.trim()).filter(Boolean),
    bounds: { ...input.bounds },
    status: "planning",
    createdAt: timestamp,
    updatedAt: timestamp,
    iterations: [{ number: 1, status: "queued" }],
    artifacts: [
      {
        key: "primary",
        kind,
        title: missionTitle(input),
        relativePath: "artifacts/primary.md",
        iteration: 1,
        state: "working",
        updatedAt: timestamp,
      },
      ...STANDARD_RESEARCH_ARTIFACTS.map((standard) => ({
        ...standard,
        iteration: 1,
        state: "working" as const,
        updatedAt: timestamp,
      })),
    ],
    sources: [],
  };
}

/** Apply a flow-launch result without losing the pre-persisted mission. */
export function applyStartResult(
  mission: ResearchMission,
  result: ResearchFlowStartResult,
  now: Date,
): ResearchMission {
  const timestamp = now.toISOString();
  const iterationIndex = mission.iterations.length - 1;
  const current = mission.iterations[iterationIndex];
  if (!result.ok) {
    return {
      ...mission,
      status: "failed",
      updatedAt: timestamp,
      lastError: result.error || "Research session failed to start",
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? {
        ...current,
        status: "failed",
        finishedAt: timestamp,
        summary: result.error || "Research session failed to start",
      } : item),
    };
  }
  const queued = result.queued || result.executor === "travel-queue" || result.run?.status === "queued";
  return {
    ...mission,
    status: queued ? "queued" : "running",
    startedAt: mission.startedAt ?? timestamp,
    updatedAt: timestamp,
    lastError: undefined,
    iterations: mission.iterations.map((item, index) => index === iterationIndex ? {
      ...current,
      status: queued ? "queued" : "running",
      flowRunId: result.run?.id,
      sessionId: result.sessionId ?? result.run?.sessionId,
      startedAt: result.run?.startedAt ?? timestamp,
    } : item),
  };
}

const SESSION_STARTUP_GRACE_MS = 60_000;

/** Keep registration races from being misclassified as dead agent sessions. */
export function withinStartupGrace(startedAt: string | undefined, now: Date): boolean {
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  return Math.abs(now.getTime() - started) < SESSION_STARTUP_GRACE_MS;
}

export function stopBeforeNextIteration(mission: ResearchMission, now: Date): string | null {
  if (mission.iterations.length >= mission.bounds.maxIterations) return "Iteration limit reached";
  const startedAt = mission.startedAt ? Date.parse(mission.startedAt) : Number.NaN;
  if (Number.isFinite(startedAt) && now.getTime() - startedAt >= mission.bounds.wallClockMinutes * 60_000) {
    return "Wall-clock limit reached";
  }
  const knownCosts = mission.iterations
    .map((iteration) => iteration.costUsd)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (mission.bounds.stopWhenCostUnavailable && mission.iterations.some((iteration) => iteration.finishedAt && iteration.costUsd === undefined)) {
    return "Cost unavailable; review before another iteration";
  }
  if (mission.bounds.maxSpendUsd !== undefined && knownCosts.reduce((sum, value) => sum + value, 0) >= mission.bounds.maxSpendUsd) {
    return "Reported spend limit reached";
  }
  return null;
}
