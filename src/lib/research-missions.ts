import { parseCodexRrule, RRULE_DAY_LABEL } from "./codex-automation-form.ts";

export const RESEARCH_MISSION_MODES = [
  "brief",
  "sweep",
  "paper",
  "autoresearch",
] as const;

export type ResearchMissionMode = (typeof RESEARCH_MISSION_MODES)[number];

export type ResearchMissionStatus =
  | "queued"
  | "planning"
  | "running"
  | "checkpoint"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export type ResearchMissionAction =
  | "retry"
  | "continue"
  | "refine"
  | "finish"
  | "pause"
  | "resume"
  | "cancel"
  | "archive";

export type ResearchBounds = {
  wallClockMinutes: number;
  maxIterations: number;
  sourceTarget: number;
  maxSpendUsd?: number;
  checkpointEvery: number;
  stopWhenCostUnavailable: boolean;
};

export type ResearchIterationStatus =
  | "queued"
  | "running"
  | "checkpoint"
  | "completed"
  | "failed"
  | "cancelled";

export type ResearchIteration = {
  number: number;
  status: ResearchIterationStatus;
  flowRunId?: string;
  sessionId?: string;
  automationRunId?: string;
  startedAt?: string;
  finishedAt?: string;
  costUsd?: number;
  summary?: string;
  decision?: "continue" | "checkpoint" | "complete";
  decisionReason?: string;
  steps?: Array<{
    id: string;
    type: string;
    status: "pending" | "running" | "succeeded" | "failed" | "skipped";
    detail?: string;
  }>;
};

export const RESEARCH_ARTIFACT_KINDS = [
  "brief",
  "report",
  "paper",
  "findings",
  "source-ledger",
  "research-log",
  "presentation",
] as const;

export type ResearchArtifactKind = (typeof RESEARCH_ARTIFACT_KINDS)[number];

export type ResearchArtifactRef = {
  key: string;
  kind: ResearchArtifactKind;
  title: string;
  relativePath: string;
  knowledgeId?: string;
  iteration: number;
  state: "working" | "published" | "rejected";
  rejectionReason?: string;
  updatedAt: string;
};

export type ResearchSourceRef = {
  id: string;
  title: string;
  url?: string;
  localPath?: string;
  publisher?: string;
  publishedAt?: string;
  sourceType: string;
  claim?: string;
  note?: string;
  confidence?: number;
  status: "candidate" | "used" | "conflicting" | "rejected";
};

export type ResearchSourceDraft = Partial<ResearchSourceRef> & {
  id: string;
  title: string;
};

export type ResearchSourcePatch = Partial<
  Pick<ResearchSourceRef, "title" | "publisher" | "publishedAt" | "sourceType" | "claim" | "note" | "confidence" | "status">
>;

export type ResearchAutomationLink = {
  id: string;
  rrule: string;
  status: "ACTIVE" | "PAUSED";
  checkpointFingerprint: string;
  checkpointToken?: string;
  lastRunId?: string;
  lastRunStatus?: "queued" | "running" | "succeeded" | "failed";
  lastRunAt?: string;
  stopReason?: string;
};

export type ResearchMission = {
  version: 1;
  id: string;
  familiarId: string;
  title: string;
  intent: string;
  direction?: string;
  mode: ResearchMissionMode;
  modeSource: "auto" | "user";
  deliverable: string;
  audience?: string;
  projectRoot?: string;
  constraints: string[];
  bounds: ResearchBounds;
  status: ResearchMissionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  automation?: ResearchAutomationLink;
  /** @deprecated Read automation.id instead. */
  automationId?: string;
  iterations: ResearchIteration[];
  artifacts: ResearchArtifactRef[];
  sources: ResearchSourceRef[];
  lastError?: string;
};

export type CreateResearchMissionInput = {
  familiarId: string;
  title?: string;
  intent: string;
  mode: ResearchMissionMode;
  modeSource: "auto" | "user";
  deliverable: string;
  audience?: string;
  projectRoot?: string;
  constraints?: string[];
  bounds: ResearchBounds;
};

export type ResearchMissionActionInput =
  | {
    action: ResearchMissionAction;
    direction?: string;
    /**
     * Retry-only project root override: a path re-targets the retried
     * iteration (validated server-side against allowed project roots), null
     * clears a configured root so the retry runs in the mission workspace.
     */
    projectRoot?: string | null;
  }
  | { action: "attach-source"; source: ResearchSourceDraft }
  | { action: "update-source"; sourceId: string; patch: ResearchSourcePatch }
  | { action: "reject-artifact"; artifactKey: string; reason: string };

export type CreateResearchMissionResult =
  | { ok: true; value: CreateResearchMissionInput }
  | { ok: false; error: string };

const FAMILIAR_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function validateCreateResearchMissionInput(
  input: unknown,
): CreateResearchMissionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "research mission input required" };
  }
  const value = input as Record<string, unknown>;
  const familiarId = typeof value.familiarId === "string" ? value.familiarId.trim() : "";
  if (!FAMILIAR_ID_RE.test(familiarId) || familiarId.includes("..")) {
    return { ok: false, error: "invalid familiar id" };
  }
  const intent = typeof value.intent === "string" ? value.intent.trim() : "";
  if (!intent || intent.length > 10_000) {
    return { ok: false, error: "intent must be between 1 and 10000 characters" };
  }
  if (!(RESEARCH_MISSION_MODES as readonly unknown[]).includes(value.mode)) {
    return { ok: false, error: "invalid research mode" };
  }
  if (value.modeSource !== "auto" && value.modeSource !== "user") {
    return { ok: false, error: "invalid mode source" };
  }
  const deliverable = typeof value.deliverable === "string" ? value.deliverable.trim() : "";
  if (!deliverable || deliverable.length > 160) {
    return { ok: false, error: "deliverable required" };
  }
  const bounds = normalizeResearchBounds(
    value.bounds && typeof value.bounds === "object"
      ? value.bounds as Partial<ResearchBounds>
      : {},
  );
  if (!bounds.ok) return { ok: false, error: bounds.reason };
  const constraints = Array.isArray(value.constraints)
    ? value.constraints
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((item) => item.slice(0, 500))
    : [];
  const optionalText = (field: "title" | "audience" | "projectRoot", max: number) => {
    const raw = value[field];
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw !== "string" || raw.includes("\0")) return null;
    return raw.trim().slice(0, max) || undefined;
  };
  const title = optionalText("title", 160);
  const audience = optionalText("audience", 500);
  const projectRoot = optionalText("projectRoot", 2_000);
  if (title === null || audience === null || projectRoot === null) {
    return { ok: false, error: "invalid optional research field" };
  }
  return {
    ok: true,
    value: {
      familiarId,
      ...(title ? { title } : {}),
      intent,
      mode: value.mode as ResearchMissionMode,
      modeSource: value.modeSource,
      deliverable,
      ...(audience ? { audience } : {}),
      ...(projectRoot ? { projectRoot } : {}),
      constraints,
      bounds: bounds.value,
    },
  };
}

export type ResearchBoundsResult =
  | { ok: true; value: ResearchBounds }
  | { ok: false; reason: string };

/** Server-enforced upper limits for research bounds; the composer clamps to these. */
export const RESEARCH_BOUND_LIMITS = {
  wallClockMinutes: 24 * 60,
  maxIterations: 100,
  sourceTarget: 500,
  checkpointEvery: 100,
  maxSpendUsd: 100_000,
} as const;

const BOUND_LIMITS = RESEARCH_BOUND_LIMITS;

function positiveInteger(
  value: unknown,
  field: keyof typeof BOUND_LIMITS,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value > 0 && value <= BOUND_LIMITS[field] ? value : null;
}

export function normalizeResearchBounds(
  input: Partial<ResearchBounds>,
): ResearchBoundsResult {
  const wallClockMinutes = positiveInteger(input.wallClockMinutes, "wallClockMinutes");
  const maxIterations = positiveInteger(input.maxIterations, "maxIterations");
  const sourceTarget = positiveInteger(input.sourceTarget, "sourceTarget");
  const checkpointEvery = positiveInteger(input.checkpointEvery, "checkpointEvery");
  if (wallClockMinutes === null) return { ok: false, reason: "Invalid wall-clock limit" };
  if (maxIterations === null) return { ok: false, reason: "Invalid iteration limit" };
  if (sourceTarget === null) return { ok: false, reason: "Invalid source target" };
  if (checkpointEvery === null || checkpointEvery > maxIterations) {
    return { ok: false, reason: "Invalid checkpoint interval" };
  }
  if (typeof input.stopWhenCostUnavailable !== "boolean") {
    return { ok: false, reason: "Invalid cost-availability policy" };
  }
  if (
    input.maxSpendUsd !== undefined &&
    (typeof input.maxSpendUsd !== "number" ||
      !Number.isFinite(input.maxSpendUsd) ||
      input.maxSpendUsd <= 0 ||
      input.maxSpendUsd > BOUND_LIMITS.maxSpendUsd)
  ) {
    return { ok: false, reason: "Invalid spend limit" };
  }

  return {
    ok: true,
    value: {
      wallClockMinutes,
      maxIterations,
      sourceTarget,
      ...(input.maxSpendUsd === undefined ? {} : { maxSpendUsd: input.maxSpendUsd }),
      checkpointEvery,
      stopWhenCostUnavailable: input.stopWhenCostUnavailable,
    },
  };
}

export function allowedResearchActions(
  mission: Pick<ResearchMission, "status">,
): ResearchMissionAction[] {
  if (["queued", "planning", "running"].includes(mission.status)) return ["cancel"];
  if (mission.status === "checkpoint") {
    return ["continue", "refine", "finish", "cancel", "archive"];
  }
  if (mission.status === "paused") {
    return ["resume", "refine", "finish", "cancel", "archive"];
  }
  if (mission.status === "failed") return ["retry", "finish", "archive"];
  if (mission.status === "completed" || mission.status === "cancelled") {
    return ["continue", "archive"];
  }
  return [];
}

export type ResearchPhaseStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

type ResearchPhaseOutcome = "success" | "failure" | "cancelled" | null;

function settledPhaseOutcome(
  mission: Pick<ResearchMission, "status">,
  iteration: Pick<ResearchIteration, "status"> | undefined,
): ResearchPhaseOutcome {
  // A finished iteration knows its own outcome; prefer it so an archived
  // completed mission still reads as a success trajectory.
  if (iteration?.status === "completed" || iteration?.status === "checkpoint") return "success";
  if (iteration?.status === "failed") return "failure";
  if (iteration?.status === "cancelled") return "cancelled";
  // Otherwise settle by terminal mission status (covers stale iteration
  // snapshots, e.g. a mission archived while its iteration still said running).
  if (mission.status === "completed") return "success";
  if (mission.status === "failed") return "failure";
  if (mission.status === "cancelled" || mission.status === "archived") return "cancelled";
  return null;
}

/**
 * Reconciled phase statuses for the latest iteration, in phase order.
 *
 * Step snapshots only sync while a flow run is live, so terminal missions keep
 * whatever was last written (often "scope running, rest pending"). A settled
 * run must never render a running or pending phase:
 * - success (completed / checkpoint) — the run finished every chained phase,
 *   so stale running/pending phases read succeeded; explicit failed/skipped
 *   step reports are preserved.
 * - failure — the first stale running/pending phase is where the run died and
 *   reads failed (unless a step already reported failed); stale phases before
 *   the failure point read succeeded (the sequential chain reached it) and
 *   later unfinished phases read skipped.
 * - cancelled/archived mid-run — unfinished phases read skipped.
 * Live missions pass raw step statuses through unchanged.
 */
export function researchPhaseStatuses(
  mission: Pick<ResearchMission, "status" | "iterations">,
  phaseIds: readonly string[],
): ResearchPhaseStatus[] {
  const iteration = mission.iterations.at(-1);
  const raw = phaseIds.map((phase): ResearchPhaseStatus =>
    iteration?.steps?.find((step) => step.id === phase)?.status ?? "pending");
  const outcome = settledPhaseOutcome(mission, iteration);
  if (outcome === null) return raw;
  if (outcome === "success") {
    return raw.map((status) => status === "running" || status === "pending" ? "succeeded" : status);
  }
  if (outcome === "cancelled") {
    return raw.map((status) => status === "running" || status === "pending" ? "skipped" : status);
  }
  const explicitFailure = raw.indexOf("failed");
  const firstUnfinished = raw.findIndex((status) => status === "running" || status === "pending");
  const failureAt = explicitFailure !== -1
    ? explicitFailure
    : firstUnfinished;
  return raw.map((status, index) => {
    if (status !== "running" && status !== "pending") return status;
    if (index < failureAt) return "succeeded";
    if (index === failureAt) return "failed";
    return "skipped";
  });
}

/**
 * Whether the mission intent says anything the title does not.
 *
 * missionTitle copies a short intent verbatim (and truncates a long one with
 * an ellipsis), so most detail headers would otherwise print the same
 * sentence twice. Comparison normalizes whitespace and case; truncated and
 * explicitly customized titles keep the intent line because the full
 * sentence still carries information.
 */
export function researchIntentAddsContext(
  mission: Pick<ResearchMission, "title" | "intent">,
): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(mission.intent) !== normalize(mission.title);
}

export type ResearchBoundReading = {
  id: "time" | "sources" | "checkpoint" | "spend";
  label: string;
  value: string;
  /** over = past a stop gate (warn); met = target reached (good). */
  tone: "neutral" | "over" | "met";
  badge?: "over" | "met";
  /** Plain-prose gate-vs-target semantics for tooltips and screen readers. */
  detail: string;
};

/**
 * Bound-meter rows with honest over/met states.
 *
 * Wall-clock minutes and reported spend are stop gates checked between
 * iterations — a running iteration may legitimately finish past them, so
 * exceeding one is a fact worth flagging, not a silent detail. The source
 * count is a target, not a cap: reaching it is success. Badges only claim
 * "over" when a value is strictly past its bound; a stop at the exact
 * boundary is already explained by the mission's decision banner.
 */
export function researchBoundReadings(
  mission: Pick<ResearchMission, "bounds" | "sources" | "iterations" | "startedAt" | "finishedAt" | "updatedAt">,
): ResearchBoundReading[] {
  const { bounds } = mission;
  const elapsedMs = mission.startedAt
    ? Math.max(0, Date.parse(mission.finishedAt ?? mission.updatedAt) - Date.parse(mission.startedAt))
    : 0;
  const elapsedMinutes = Math.round(elapsedMs / 60_000);
  const timeOver = elapsedMs > bounds.wallClockMinutes * 60_000;
  const sourcesMet = mission.sources.length >= bounds.sourceTarget;
  const reportedCost = mission.iterations.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
  const hasReportedCost = mission.iterations.some((item) => item.costUsd !== undefined);
  const spendOver = hasReportedCost && bounds.maxSpendUsd !== undefined && reportedCost > bounds.maxSpendUsd;
  const spend: ResearchBoundReading = hasReportedCost
    ? {
      id: "spend",
      label: "Spend",
      value: `$${reportedCost.toFixed(2)}${bounds.maxSpendUsd === undefined ? " reported" : `/$${bounds.maxSpendUsd.toFixed(2)}`}`,
      tone: spendOver ? "over" : "neutral",
      ...(spendOver ? { badge: "over" as const } : {}),
      detail: bounds.maxSpendUsd === undefined
        ? "Reported spend so far; no spend cap is set."
        : spendOver
          ? "Reported spend is past the cap — no further iterations will start."
          : "Spend cap is a stop gate checked between iterations.",
    }
    : {
      id: "spend",
      label: "Spend",
      value: "—",
      tone: "neutral",
      detail: "Cost unavailable — the harness has not reported spend.",
    };
  return [
    {
      id: "time",
      label: "Time",
      value: `${elapsedMinutes}/${bounds.wallClockMinutes} min`,
      tone: timeOver ? "over" : "neutral",
      ...(timeOver ? { badge: "over" as const } : {}),
      detail: timeOver
        ? "Past the wall-clock budget — it is a stop gate checked between iterations, so a running iteration may finish over it, but no further iterations will start."
        : "Wall-clock budget is a stop gate checked between iterations.",
    },
    {
      id: "sources",
      label: "Sources",
      value: `${mission.sources.length}/${bounds.sourceTarget}`,
      tone: sourcesMet ? "met" : "neutral",
      ...(sourcesMet ? { badge: "met" as const } : {}),
      detail: sourcesMet
        ? "Source target reached — it is a goal, not a cap."
        : "Source target is a goal, not a cap.",
    },
    {
      id: "checkpoint",
      label: "Checkpoint",
      value: `every ${bounds.checkpointEvery} iteration${bounds.checkpointEvery === 1 ? "" : "s"}`,
      tone: "neutral",
      detail: "How often the mission pauses for review.",
    },
    spend,
  ];
}

/**
 * Human-readable schedule for an autoresearch Automation link. Understands the
 * daily/weekly RRULEs the desk itself creates; anything else falls back to the
 * rule text without the RRULE: prefix rather than pretending to parse it.
 */
export function describeResearchSchedule(rrule: string | null | undefined): string {
  const raw = rrule?.trim();
  if (!raw) return "Not scheduled";
  const parsed = parseCodexRrule(raw);
  if (parsed.mode === "daily") return `Daily at ${parsed.time}`;
  if (parsed.mode === "weekly") {
    if (!/BYDAY=/.test(raw)) return `Weekly at ${parsed.time}`;
    const days = parsed.days.map((day) => RRULE_DAY_LABEL[day] ?? day).join(", ");
    return `Weekly on ${days} at ${parsed.time}`;
  }
  return raw.replace(/^RRULE:/, "");
}
