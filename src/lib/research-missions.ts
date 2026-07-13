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
  | { action: ResearchMissionAction; direction?: string }
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

const BOUND_LIMITS = {
  wallClockMinutes: 24 * 60,
  maxIterations: 100,
  sourceTarget: 500,
  checkpointEvery: 100,
  maxSpendUsd: 100_000,
} as const;

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
