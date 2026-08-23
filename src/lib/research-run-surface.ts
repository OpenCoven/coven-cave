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
      reviewed: mission.sources.length,
      retained: sourceCounts.used,
      rejected: sourceCounts.rejected,
      artifacts: mission.artifacts.filter((artifact) => artifact.state !== "rejected").length,
    },
    startedAt: mission.startedAt,
    updatedAt: mission.updatedAt,
  };
}

export type ResearchRunMarker = ResearchRunSurfaceModel;

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

function attrs(raw: string): Record<string, string> {
  const value: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) value[match[1]] = match[2];
  return value;
}

function nonNegativeInt(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
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
  if (!text || !text.includes("<coven:r")) return { visible: text, runs: [] };

  const codeRanges = markdownCodeRanges(text);
  const byId = new Map<string, ResearchRunMarker>();
  MARKER_RE.lastIndex = 0;
  const visible = text.replace(MARKER_RE, (marker, raw: string, index: number) => {
    if (codeRanges.some(([start, end]) => index >= start && index < end)) return marker;
    const value = attrs(raw ?? "");
    const runId = value["run-id"]?.trim();
    const title = value.title?.trim();
    const status = value.status?.trim() as ResearchRunSurfaceStatus | undefined;
    if (!runId || !title || !status || !VALID_STATUSES.has(status)) return "";

    const step = nonNegativeInt(value.step);
    const total = nonNegativeInt(value.total);
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

  return { visible, runs: [...byId.values()] };
}
