import { markdownCodeRanges } from "./github-blocks.ts";
import type { ResearchMission } from "./research-missions.ts";

export type ResearchRunSurfaceStatus =
  | "planning"
  | "queued"
  | "running"
  | "awaiting_input"
  | "awaiting_authority"
  | "paused"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type ResearchRunStepStatus =
  | "pending"
  | "active"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type ResearchRunStep = {
  id: string;
  label: string;
  status: ResearchRunStepStatus;
  detail?: string;
};

export type ResearchRunSurfaceModel = {
  runId: string;
  title: string;
  status: ResearchRunSurfaceStatus;
  familiarId?: string;
  skill?: string;
  runtime?: string;
  activity?: string;
  activityDetail?: string;
  steps: ResearchRunStep[];
  evidence: {
    /** Sources recorded by the canonical run; this does not imply review. */
    sources?: number;
    /** Explicit executor-reported review count, when available. */
    reviewed?: number;
    retained?: number;
    rejected?: number;
    cited?: number;
    artifacts?: number;
  };
  startedAt?: string;
  updatedAt?: string;
};

const MISSION_STATUS: Record<ResearchMission["status"], ResearchRunSurfaceStatus> = {
  queued: "queued",
  planning: "planning",
  running: "running",
  checkpoint: "awaiting_input",
  paused: "paused",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  archived: "completed",
};

const STEP_STATUS: Record<
  NonNullable<ResearchMission["iterations"][number]["steps"]>[number]["status"],
  ResearchRunStepStatus
> = {
  pending: "pending",
  running: "active",
  succeeded: "completed",
  failed: "failed",
  skipped: "skipped",
};

function humanizeStep(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function researchMissionToRunSurface(mission: ResearchMission): ResearchRunSurfaceModel {
  const iteration = mission.iterations.at(-1);
  const steps = (iteration?.steps ?? []).map((step) => ({
    id: step.id,
    label: humanizeStep(step.type || step.id),
    status: STEP_STATUS[step.status],
    ...(step.detail ? { detail: step.detail } : {}),
  }));
  const active = steps.find((step) => step.status === "active");
  const sourceCounts = mission.sources.reduce(
    (counts, source) => {
      counts[source.status] += 1;
      return counts;
    },
    { candidate: 0, used: 0, conflicting: 0, rejected: 0 },
  );

  return {
    runId: mission.id,
    title: mission.title,
    status: MISSION_STATUS[mission.status],
    familiarId: mission.familiarId,
    skill: `research:${mission.mode}`,
    runtime: [mission.harness, mission.model].filter(Boolean).join(" · ") || undefined,
    activity: active?.detail ?? iteration?.summary,
    steps,
    evidence: {
      sources: mission.sources.length,
      retained: sourceCounts.used,
      rejected: sourceCounts.rejected,
      artifacts: mission.artifacts.filter((artifact) => artifact.state !== "rejected").length,
    },
    startedAt: mission.startedAt,
    updatedAt: mission.updatedAt,
  };
}

export type ResearchRunMarker = ResearchRunSurfaceModel;

/**
 * Bootstrap projection for a research run that chat knows only by id (e.g. a
 * turn persisted with `researchRunId` after `/research` started the run). The
 * id is the durable reference — the surface is intentionally minimal so the
 * inline card immediately rehydrates from the canonical mission API instead of
 * rendering a frozen copy of UI state (#4808).
 */
export function researchRunBootstrapSnapshot(
  runId: string,
  title?: string,
): ResearchRunSurfaceModel {
  return {
    runId,
    title: title?.trim() || "Research run",
    status: "queued",
    steps: [],
    evidence: {},
  };
}

export const MAX_RESEARCH_RUN_STEPS = 24;
export const RESEARCH_RUN_PREVIEW_PREFIX = "/__coven/research/";
const RESEARCH_RUN_PREVIEW_ORIGIN = "http://127.0.0.1";
const MAX_RESEARCH_RUN_SNAPSHOT_LENGTH = 16_384;

const MARKER_RE = /<coven:research\b((?:[^">]|"[^"]*")*?)\/?>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;
const VALID_STATUSES = new Set<ResearchRunSurfaceStatus>([
  "planning",
  "queued",
  "running",
  "awaiting_input",
  "awaiting_authority",
  "paused",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
const VALID_STEP_STATUSES = new Set<ResearchRunStepStatus>([
  "pending",
  "active",
  "completed",
  "blocked",
  "failed",
  "skipped",
]);

function attrs(raw: string): Record<string, string> {
  const value: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) value[match[1]] = match[2];
  return value;
}

function nonNegativeInt(value: string | undefined, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined;
}

function optionalSnapshotString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= 2_048 ? value : null;
}

export function researchRunPreviewUrl(run: ResearchRunSurfaceModel): string {
  const url = new URL(
    `${RESEARCH_RUN_PREVIEW_ORIGIN}${RESEARCH_RUN_PREVIEW_PREFIX}${encodeURIComponent(run.runId)}`,
  );
  url.searchParams.set("status", run.status);
  url.searchParams.set("title", run.title);
  url.searchParams.set("snapshot", JSON.stringify(run));
  return url.toString();
}

export function parseResearchRunPreviewUrl(value: string): ResearchRunSurfaceModel | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== "127.0.0.1" || !url.pathname.startsWith(RESEARCH_RUN_PREVIEW_PREFIX)) return null;
  const encodedId = url.pathname.slice(RESEARCH_RUN_PREVIEW_PREFIX.length);
  if (!encodedId || encodedId.includes("/")) return null;
  let runId: string;
  try {
    runId = decodeURIComponent(encodedId).trim();
  } catch {
    return null;
  }
  if (!runId) return null;

  const snapshotText = url.searchParams.get("snapshot");
  if (!snapshotText) {
    const status = url.searchParams.get("status") as ResearchRunSurfaceStatus | null;
    if (!status || !VALID_STATUSES.has(status)) return null;
    return {
      runId,
      title: url.searchParams.get("title")?.trim() || "Research run",
      status,
      skill: "research",
      steps: [],
      evidence: {},
    };
  }
  if (snapshotText.length > MAX_RESEARCH_RUN_SNAPSHOT_LENGTH) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.runId !== runId || typeof candidate.title !== "string" || candidate.title.length > 2_048) return null;
  if (typeof candidate.status !== "string" || !VALID_STATUSES.has(candidate.status as ResearchRunSurfaceStatus)) return null;
  if (!Array.isArray(candidate.steps) || candidate.steps.length > MAX_RESEARCH_RUN_STEPS) return null;

  const steps: ResearchRunStep[] = [];
  for (const rawStep of candidate.steps) {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) return null;
    const step = rawStep as Record<string, unknown>;
    const detail = optionalSnapshotString(step.detail);
    if (
      typeof step.id !== "string" || !step.id || step.id.length > 2_048
      || typeof step.label !== "string" || !step.label || step.label.length > 2_048
      || typeof step.status !== "string" || !VALID_STEP_STATUSES.has(step.status as ResearchRunStepStatus)
      || detail === null
    ) return null;
    steps.push({
      id: step.id,
      label: step.label,
      status: step.status as ResearchRunStepStatus,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  if (!candidate.evidence || typeof candidate.evidence !== "object" || Array.isArray(candidate.evidence)) return null;
  const evidenceSource = candidate.evidence as Record<string, unknown>;
  const evidence: ResearchRunSurfaceModel["evidence"] = {};
  for (const key of ["sources", "reviewed", "retained", "rejected", "cited", "artifacts"] as const) {
    const count = evidenceSource[key];
    if (count === undefined) continue;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
    evidence[key] = count;
  }

  const familiarId = optionalSnapshotString(candidate.familiarId);
  const skill = optionalSnapshotString(candidate.skill);
  const runtime = optionalSnapshotString(candidate.runtime);
  const activity = optionalSnapshotString(candidate.activity);
  const activityDetail = optionalSnapshotString(candidate.activityDetail);
  const startedAt = optionalSnapshotString(candidate.startedAt);
  const updatedAt = optionalSnapshotString(candidate.updatedAt);
  if (
    familiarId === null || skill === null || runtime === null || activity === null
    || activityDetail === null || startedAt === null || updatedAt === null
  ) return null;

  return {
    runId,
    title: candidate.title,
    status: candidate.status as ResearchRunSurfaceStatus,
    ...(familiarId !== undefined ? { familiarId } : {}),
    ...(skill !== undefined ? { skill } : {}),
    ...(runtime !== undefined ? { runtime } : {}),
    ...(activity !== undefined ? { activity } : {}),
    ...(activityDetail !== undefined ? { activityDetail } : {}),
    steps,
    evidence,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function hasUnquotedGtAfter(value: string, from: number): boolean {
  let inQuote = false;
  for (let index = from; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') inQuote = !inQuote;
    else if (char === ">" && !inQuote) return true;
  }
  return false;
}

/**
 * Chat transport for research-run snapshots emitted by Coven-native skills.
 * Markers are deliberately small and declarative; durable state continues to
 * live in the Research mission/run store. Repeated markers for the same run
 * update the card in place by keeping the final snapshot in a turn.
 *
 * Example:
 * <coven:research run-id="abc" title="Dependency research" status="running"
 *   activity="Surveying lock-in incidents" step="2" total="5"
 *   reviewed="12" cited="3" />
 */
export function extractResearchRunMarkers(
  text: string,
): { visible: string; runs: ResearchRunMarker[] } {
  if (!text || !text.includes("<")) return { visible: text, runs: [] };

  const codeRanges = markdownCodeRanges(text);
  const byId = new Map<string, ResearchRunMarker>();
  MARKER_RE.lastIndex = 0;
  let visible = text.replace(MARKER_RE, (marker, raw: string, index: number) => {
    if (codeRanges.some(([start, end]) => index >= start && index < end)) return marker;
    const value = attrs(raw ?? "");
    const runId = value["run-id"]?.trim();
    const title = value.title?.trim();
    const status = value.status?.trim() as ResearchRunSurfaceStatus | undefined;
    if (!runId || !title || !status || !VALID_STATUSES.has(status)) return "";

    const step = nonNegativeInt(value.step);
    const total = nonNegativeInt(value.total, MAX_RESEARCH_RUN_STEPS);
    const steps: ResearchRunStep[] = [];
    if (step !== undefined && total !== undefined && total > 0) {
      for (let i = 1; i <= total; i += 1) {
        steps.push({
          id: `stage-${i}`,
          label: `Stage ${i}`,
          status: i < step ? "completed" : i === step ? "active" : "pending",
        });
      }
    }

    byId.set(runId, {
      runId,
      title,
      status,
      familiarId: value.familiar?.trim() || undefined,
      skill: value.skill?.trim() || "research",
      runtime: value.runtime?.trim() || undefined,
      activity: value.activity?.trim() || undefined,
      steps,
      evidence: {
        sources: nonNegativeInt(value.sources),
        reviewed: nonNegativeInt(value.reviewed),
        retained: nonNegativeInt(value.retained),
        rejected: nonNegativeInt(value.rejected),
        cited: nonNegativeInt(value.cited),
        artifacts: nonNegativeInt(value.artifacts),
      },
      updatedAt: value.updated?.trim() || undefined,
    });
    return "";
  });

  // Hide an unterminated marker tail while a streamed turn is still building
  // it. Fenced examples remain literal, mirroring the skill/GitHub marker
  // contracts so protocol syntax never flashes in user-visible prose.
  const tail = visible.lastIndexOf("<");
  if (
    tail !== -1
    && !hasUnquotedGtAfter(visible, tail)
    && !markdownCodeRanges(visible).some(([start, end]) => tail >= start && tail < end)
  ) {
    const fragment = visible.slice(tail);
    if ("<coven:research".startsWith(fragment)) {
      visible = visible.slice(0, tail);
    }
  }

  return { visible, runs: [...byId.values()] };
}
