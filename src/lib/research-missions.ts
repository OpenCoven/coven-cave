import { parseCodexRrule, RRULE_DAY_LABEL } from "./codex-automation-form.ts";
import { hasUnpairedUtf16Surrogate } from "./utf16.ts";

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

/** Mode → primary-deliverable kind. Single source of truth — the lifecycle
 *  and runner previously duplicated this mapping privately. */
export function researchArtifactKindForMode(mode: ResearchMissionMode): ResearchArtifactKind {
  if (mode === "sweep") return "report";
  if (mode === "paper") return "paper";
  if (mode === "autoresearch") return "findings";
  return "brief";
}

/** The always-produced workspace files every mission must track and save,
 *  beyond the mode-specific primary deliverable. */
export const STANDARD_RESEARCH_ARTIFACTS: ReadonlyArray<
  Pick<ResearchArtifactRef, "key" | "kind" | "title" | "relativePath">
> = [
  { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md" },
  { key: "source-ledger", kind: "source-ledger", title: "Source ledger", relativePath: "sources.json" },
  { key: "research-log", kind: "research-log", title: "Research log", relativePath: "research-log.md" },
];

/** Additive backfill for missions created before the standard refs existed:
 *  appends any standard ref whose key is absent. Never overwrites, never
 *  reorders (the primary working copy must stay first), identity when
 *  nothing is missing; stamped no fresher than the primary so draft-picking
 *  sorts stay stable. */
export function ensureStandardArtifactRefs(mission: ResearchMission): ResearchMission {
  const missing = STANDARD_RESEARCH_ARTIFACTS.filter(
    (standard) => !mission.artifacts.some((artifact) => artifact.key === standard.key),
  );
  if (missing.length === 0) return mission;
  const iteration = mission.iterations.at(-1)?.number ?? 1;
  const stampedAt = mission.artifacts[0]?.updatedAt ?? mission.createdAt;
  return {
    ...mission,
    artifacts: [
      ...mission.artifacts,
      ...missing.map((standard) => ({
        ...standard,
        iteration,
        state: "working" as const,
        updatedAt: stampedAt,
      })),
    ],
  };
}

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
  /** Resolved at creation so a mission's runtime cannot drift mid-flight. */
  harness?: string;
  model?: string;
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

const DIAGNOSTIC_REFERENCE_MAX_LENGTH = 256;
const DIAGNOSTIC_REFERENCE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function diagnosticReference(value: string | undefined) {
  if (value === undefined) return { value: null, redacted: false } as const;
  // Run references are useful support correlators, but the persisted schema
  // does not constrain them. Do not let a malformed runtime value turn the
  // clipboard into a path or URL disclosure channel.
  if (
    value.length > DIAGNOSTIC_REFERENCE_MAX_LENGTH
    // These fields are persisted as unrestricted strings. A permissive slug
    // check still accepts a hyphenated research brief, so retain only the UUID
    // references minted by the flow/session stores; redact legacy or malformed
    // values rather than turning the support record into a content channel.
    || !DIAGNOSTIC_REFERENCE_UUID_RE.test(value)
  ) {
    return { value: null, redacted: true } as const;
  }
  return { value, redacted: false } as const;
}

/**
 * A deliberately bounded, shareable support record. It is derived entirely
 * from persisted mission state: it never claims to be a daemon log, and it
 * omits local paths, source URLs, the research brief, and other content that
 * would make a clipboard handoff unexpectedly disclose workspace data.
 */
export function researchDiagnosticTrace(mission: ResearchMission) {
  const latestIteration = mission.iterations.at(-1) ?? null;
  const sourceCounts = researchSourceStatusCounts(mission.sources);
  const steps = latestIteration?.steps ?? [];
  // Iteration fields are persisted free text, so never put their contents in a
  // clipboard report. Keep a small, ordered status trace instead: it is enough
  // to locate the failed phase without turning support copy into a channel for
  // a prompt, source, filesystem path, or daemon output.
  const capturedPhases = steps.slice(0, 50).map((step) => step.status);
  const artifactStates = { working: 0, published: 0, rejected: 0 };
  const artifactKinds = Object.fromEntries(
    RESEARCH_ARTIFACT_KINDS.map((kind) => [kind, 0]),
  ) as Record<ResearchArtifactKind, number>;
  for (const artifact of mission.artifacts) {
    artifactStates[artifact.state] += 1;
    artifactKinds[artifact.kind] += 1;
  }
  return {
    schema: "coven-cave.research-diagnostic.v1",
    // The record is a snapshot of persisted state, not a live daemon event.
    // Keeping this deterministic also prevents a server/client hydration drift
    // when the diagnostics dialog is rendered in a Client Component.
    generatedAt: mission.updatedAt,
    mission: {
      id: mission.id,
      mode: mission.mode,
      status: mission.status,
      createdAt: mission.createdAt,
      startedAt: mission.startedAt ?? null,
      updatedAt: mission.updatedAt,
      finishedAt: mission.finishedAt ?? null,
      hasProjectRoot: Boolean(mission.projectRoot),
    },
    bounds: mission.bounds,
    outcome: {
      hasError: Boolean(mission.lastError),
      decision: latestIteration?.decision ?? null,
    },
    latestIteration: latestIteration ? {
      number: latestIteration.number,
      status: latestIteration.status,
      flowRun: diagnosticReference(latestIteration.flowRunId),
      session: diagnosticReference(latestIteration.sessionId),
      automationRun: diagnosticReference(latestIteration.automationRunId),
      startedAt: latestIteration.startedAt ?? null,
      finishedAt: latestIteration.finishedAt ?? null,
      costUsd: latestIteration.costUsd ?? null,
      phases: {
        recorded: steps.length,
        captured: capturedPhases.length,
        truncated: steps.length > capturedPhases.length,
        statuses: capturedPhases,
      },
    } : null,
    evidence: {
      sources: {
        recorded: mission.sources.length,
        byStatus: sourceCounts,
      },
      artifacts: {
        recorded: mission.artifacts.length,
        byState: artifactStates,
        byKind: artifactKinds,
      },
    },
    availability: {
      daemonTrace: "not-recorded",
      note: "This report contains persisted research-mission state only; no daemon trace was recorded for this run.",
    },
  } as const;
}

/**
 * Runtime the mission's iterations execute on, chosen per mission.
 *
 * Before this existed, a mission silently inherited the familiar's Coven
 * binding, so a familiar bound to `codex` could not run Research at all on a
 * daemon lacking the `sessionLaunchPolicy` capability — the launch failed with
 * "This Coven daemon cannot safely run unattended Research with workspace
 * writes" and there was no way to pick a runtime that works.
 */
export const RESEARCH_RUNTIME_DEFAULT_HARNESS = "copilot";
export const RESEARCH_MODEL_MAX_LENGTH = 200;
/**
 * Harness ids accepted for a mission, mirroring COMPATIBILITY_ADAPTERS.
 *
 * Duplicated as a literal rather than imported because this module is the
 * shared client/server contract and must stay free of adapter-registry
 * imports; research-missions.test.ts pins the two lists together so a new
 * adapter cannot drift out of this allowlist unnoticed.
 */
export const RESEARCH_HARNESS_IDS = [
  "codex",
  "claude",
  "copilot",
  "hermes",
  "grok",
  "openclaw",
  "opencode",
] as const;

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
  /**
   * Harness id (see COMPATIBILITY_ADAPTERS). Omitted means
   * RESEARCH_RUNTIME_DEFAULT_HARNESS — deliberately copilot, which is the
   * runtime Cave can launch directly without a daemon capability.
   */
  harness?: string;
  /** Harness-specific model id, passed through verbatim when supported. */
  model?: string;
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
  | { action: "reject-artifact"; artifactKey: string; reason: string }
  | { action: "publish-artifact"; artifactKey: string };

export type CreateResearchMissionResult =
  | { ok: true; value: CreateResearchMissionInput }
  | { ok: false; error: string };

const RESEARCH_MISSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FAMILIAR_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const RESEARCH_MISSION_STATUSES: ReadonlySet<ResearchMissionStatus> = new Set([
  "queued",
  "planning",
  "running",
  "checkpoint",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "archived",
]);
const RESEARCH_ITERATION_STATUSES: ReadonlySet<ResearchIterationStatus> = new Set([
  "queued",
  "running",
  "checkpoint",
  "completed",
  "failed",
  "cancelled",
]);
const RESEARCH_SOURCE_STATUSES: ReadonlySet<ResearchSourceRef["status"]> = new Set([
  "candidate",
  "used",
  "conflicting",
  "rejected",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validResearchPromptText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && !value.includes("\0")
    && !hasUnpairedUtf16Surrogate(value)
    && value.length <= maxLength;
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return typeof candidate === "string" ? candidate : null;
}

function optionalTimestamp(
  value: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return validTimestamp(candidate) ? candidate : null;
}

function parseResearchIteration(value: unknown): ResearchIteration | null {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.number)
    || (value.number as number) < 1
    || !RESEARCH_ITERATION_STATUSES.has(value.status as ResearchIterationStatus)) {
    return null;
  }
  const flowRunId = optionalString(value, "flowRunId");
  const sessionId = optionalString(value, "sessionId");
  const automationRunId = optionalString(value, "automationRunId");
  const startedAt = optionalTimestamp(value, "startedAt");
  const finishedAt = optionalTimestamp(value, "finishedAt");
  const summary = optionalString(value, "summary");
  const decisionReason = optionalString(value, "decisionReason");
  if (flowRunId === null
    || sessionId === null
    || automationRunId === null
    || startedAt === null
    || finishedAt === null
    || summary === null
    || decisionReason === null) {
    return null;
  }
  if (value.costUsd !== undefined
    && (typeof value.costUsd !== "number"
      || !Number.isFinite(value.costUsd)
      || value.costUsd < 0)) {
    return null;
  }
  if (value.decision !== undefined
    && !["continue", "checkpoint", "complete"].includes(String(value.decision))) {
    return null;
  }
  let steps: ResearchIteration["steps"];
  if (value.steps !== undefined) {
    if (!Array.isArray(value.steps)) return null;
    const parsedSteps = value.steps.map((step) => {
      if (!isRecord(step)
        || typeof step.id !== "string"
        || typeof step.type !== "string"
        || !["pending", "running", "succeeded", "failed", "skipped"].includes(
          String(step.status),
        )
        || (step.detail !== undefined && typeof step.detail !== "string")) {
        return null;
      }
      return {
        id: step.id,
        type: step.type,
        status: step.status as NonNullable<ResearchIteration["steps"]>[number]["status"],
        ...(typeof step.detail === "string" ? { detail: step.detail } : {}),
      };
    });
    if (parsedSteps.some((step) => step === null)) return null;
    steps = parsedSteps as NonNullable<ResearchIteration["steps"]>;
  }
  return {
    number: value.number as number,
    status: value.status as ResearchIterationStatus,
    ...(flowRunId !== undefined ? { flowRunId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(automationRunId !== undefined ? { automationRunId } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(finishedAt !== undefined ? { finishedAt } : {}),
    ...(typeof value.costUsd === "number" ? { costUsd: value.costUsd } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(value.decision !== undefined
      ? { decision: value.decision as ResearchIteration["decision"] }
      : {}),
    ...(decisionReason !== undefined ? { decisionReason } : {}),
    ...(steps !== undefined ? { steps } : {}),
  };
}

function parseResearchArtifact(value: unknown): ResearchArtifactRef | null {
  if (!isRecord(value)
    || typeof value.key !== "string"
    || !RESEARCH_ARTIFACT_KINDS.includes(value.kind as ResearchArtifactKind)
    || typeof value.title !== "string"
    || typeof value.relativePath !== "string"
    || !Number.isSafeInteger(value.iteration)
    || (value.iteration as number) < 1
    || !["working", "published", "rejected"].includes(String(value.state))
    || !validTimestamp(value.updatedAt)) {
    return null;
  }
  const knowledgeId = optionalString(value, "knowledgeId");
  const rejectionReason = optionalString(value, "rejectionReason");
  if (knowledgeId === null || rejectionReason === null) return null;
  return {
    key: value.key,
    kind: value.kind as ResearchArtifactKind,
    title: value.title,
    relativePath: value.relativePath,
    ...(knowledgeId !== undefined ? { knowledgeId } : {}),
    iteration: value.iteration as number,
    state: value.state as ResearchArtifactRef["state"],
    ...(rejectionReason !== undefined ? { rejectionReason } : {}),
    updatedAt: value.updatedAt,
  };
}

function parseResearchSource(value: unknown): ResearchSourceRef | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.title !== "string"
    || typeof value.sourceType !== "string"
    || !RESEARCH_SOURCE_STATUSES.has(value.status as ResearchSourceRef["status"])) {
    return null;
  }
  const url = optionalString(value, "url");
  const localPath = optionalString(value, "localPath");
  const publisher = optionalString(value, "publisher");
  const publishedAt = optionalString(value, "publishedAt");
  const claim = optionalString(value, "claim");
  const note = optionalString(value, "note");
  if (url === null
    || localPath === null
    || publisher === null
    || publishedAt === null
    || claim === null
    || note === null) {
    return null;
  }
  if (value.confidence !== undefined
    && (typeof value.confidence !== "number"
      || !Number.isFinite(value.confidence)
      || value.confidence < 0
      || value.confidence > 1)) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    ...(url !== undefined ? { url } : {}),
    ...(localPath !== undefined ? { localPath } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    sourceType: value.sourceType,
    ...(claim !== undefined ? { claim } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(typeof value.confidence === "number" ? { confidence: value.confidence } : {}),
    status: value.status as ResearchSourceRef["status"],
  };
}

function parseResearchAutomation(value: unknown): ResearchAutomationLink | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.rrule !== "string"
    || !["ACTIVE", "PAUSED"].includes(String(value.status))
    || typeof value.checkpointFingerprint !== "string") {
    return null;
  }
  const checkpointToken = optionalString(value, "checkpointToken");
  const lastRunId = optionalString(value, "lastRunId");
  const lastRunAt = optionalTimestamp(value, "lastRunAt");
  const stopReason = optionalString(value, "stopReason");
  if (checkpointToken === null
    || lastRunId === null
    || lastRunAt === null
    || stopReason === null) {
    return null;
  }
  if (value.lastRunStatus !== undefined
    && !["queued", "running", "succeeded", "failed"].includes(String(value.lastRunStatus))) {
    return null;
  }
  return {
    id: value.id,
    rrule: value.rrule,
    status: value.status as ResearchAutomationLink["status"],
    checkpointFingerprint: value.checkpointFingerprint,
    ...(checkpointToken !== undefined ? { checkpointToken } : {}),
    ...(lastRunId !== undefined ? { lastRunId } : {}),
    ...(value.lastRunStatus !== undefined
      ? { lastRunStatus: value.lastRunStatus as ResearchAutomationLink["lastRunStatus"] }
      : {}),
    ...(lastRunAt !== undefined ? { lastRunAt } : {}),
    ...(stopReason !== undefined ? { stopReason } : {}),
  };
}

export function parseResearchMission(value: unknown): ResearchMission | null {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.id !== "string"
    || !RESEARCH_MISSION_ID_RE.test(value.id)
    || typeof value.familiarId !== "string"
    || !FAMILIAR_ID_RE.test(value.familiarId)
    || !validResearchPromptText(value.title, RESEARCH_TITLE_MAX_LENGTH)
    || !validResearchPromptText(value.intent, RESEARCH_INTENT_MAX_LENGTH)
    || !RESEARCH_MISSION_MODES.includes(value.mode as ResearchMissionMode)
    || !["auto", "user"].includes(String(value.modeSource))
    || !validResearchPromptText(value.deliverable, RESEARCH_DELIVERABLE_MAX_LENGTH)
    || !value.deliverable.trim()
    || !Array.isArray(value.constraints)
    || value.constraints.length > RESEARCH_CONSTRAINT_MAX_COUNT
    || value.constraints.some((constraint) => (
      !validResearchPromptText(constraint, RESEARCH_CONSTRAINT_MAX_LENGTH)
    ))
    || !isRecord(value.bounds)
    || !RESEARCH_MISSION_STATUSES.has(value.status as ResearchMissionStatus)
    || !validTimestamp(value.createdAt)
    || !validTimestamp(value.updatedAt)
    || !Array.isArray(value.iterations)
    || !Array.isArray(value.artifacts)
    || !Array.isArray(value.sources)) {
    return null;
  }
  const bounds = normalizeResearchBounds(value.bounds as Partial<ResearchBounds>);
  if (!bounds.ok) return null;
  const direction = optionalString(value, "direction");
  const audience = optionalString(value, "audience");
  const projectRoot = optionalString(value, "projectRoot");
  const startedAt = optionalTimestamp(value, "startedAt");
  const finishedAt = optionalTimestamp(value, "finishedAt");
  const automationId = optionalString(value, "automationId");
  const lastError = optionalString(value, "lastError");
  // The mission's runtime must survive a read/write round trip. This parser
  // rebuilds from an explicit field list, so a field it does not name is
  // silently dropped — which is what happened to `harness`: it was written at
  // creation, then erased the first time the mission was re-read and saved.
  const harness = optionalString(value, "harness");
  const model = optionalString(value, "model");
  if (direction === null
    || audience === null
    || projectRoot === null
    || startedAt === null
    || finishedAt === null
    || automationId === null
    || lastError === null
    || harness === null
    || model === null) {
    return null;
  }
  // An unrecognised harness on disk is refused rather than coerced: the record
  // would otherwise claim a runtime the launcher cannot honour.
  if (harness !== undefined && !(RESEARCH_HARNESS_IDS as readonly string[]).includes(harness)) {
    return null;
  }
  if (model !== undefined && !validResearchPromptText(model, RESEARCH_MODEL_MAX_LENGTH)) {
    return null;
  }
  if ((direction !== undefined && !validResearchPromptText(direction, RESEARCH_DIRECTION_MAX_LENGTH))
    || (audience !== undefined && !validResearchPromptText(audience, RESEARCH_AUDIENCE_MAX_LENGTH))
    || (projectRoot !== undefined && !validResearchPromptText(projectRoot, RESEARCH_PROJECT_ROOT_MAX_LENGTH))) {
    return null;
  }
  const iterations = value.iterations.map(parseResearchIteration);
  const artifacts = value.artifacts.map(parseResearchArtifact);
  const sources = value.sources.map(parseResearchSource);
  if (iterations.some((iteration) => iteration === null)
    || artifacts.some((artifact) => artifact === null)
    || sources.some((source) => source === null)) {
    return null;
  }
  const automation = value.automation === undefined
    ? undefined
    : parseResearchAutomation(value.automation);
  if (automation === null) return null;
  return {
    version: 1,
    id: value.id,
    familiarId: value.familiarId,
    title: value.title,
    intent: value.intent,
    ...(direction !== undefined ? { direction } : {}),
    mode: value.mode as ResearchMissionMode,
    modeSource: value.modeSource as ResearchMission["modeSource"],
    deliverable: value.deliverable,
    ...(audience !== undefined ? { audience } : {}),
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    constraints: value.constraints as string[],
    bounds: bounds.value,
    ...(harness !== undefined ? { harness } : {}),
    ...(model !== undefined ? { model } : {}),
    status: value.status as ResearchMissionStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(finishedAt !== undefined ? { finishedAt } : {}),
    ...(automation !== undefined ? { automation } : {}),
    ...(automationId !== undefined ? { automationId } : {}),
    iterations: iterations as ResearchIteration[],
    artifacts: artifacts as ResearchArtifactRef[],
    sources: sources as ResearchSourceRef[],
    ...(lastError !== undefined ? { lastError } : {}),
  };
}

/** Minimum meaningful research intent — blocks accidental one-word launches
 *  that would still spend a real familiar session. Enforced by the create
 *  validator (server) and the desk composer (client). */
export const RESEARCH_INTENT_MIN_LENGTH = 8;
/** Upper bound on a mission brief. Raised 10k → 25k (cave-e8z): real briefs
 *  carry pasted context — prior findings, source lists, constraints — and hit
 *  the old cap, which surfaced only as a server rejection after the writing was
 *  done. The composer now shows the count as you type, so the ceiling is
 *  visible rather than discovered. */
export const RESEARCH_INTENT_MAX_LENGTH = 25_000;
export const RESEARCH_TITLE_MAX_LENGTH = 160;
export const RESEARCH_DELIVERABLE_MAX_LENGTH = 160;
export const RESEARCH_AUDIENCE_MAX_LENGTH = 500;
export const RESEARCH_PROJECT_ROOT_MAX_LENGTH = 2_000;
export const RESEARCH_DIRECTION_MAX_LENGTH = 10_000;
export const RESEARCH_CONSTRAINT_MAX_COUNT = 20;
export const RESEARCH_CONSTRAINT_MAX_LENGTH = 500;

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
  const rawIntent = typeof value.intent === "string" ? value.intent : "";
  const intent = rawIntent.trim();
  if (intent.includes("\0")) {
    return { ok: false, error: "intent contains an invalid NUL character" };
  }
  if (hasUnpairedUtf16Surrogate(rawIntent)) {
    return { ok: false, error: "intent contains invalid Unicode" };
  }
  if (intent.length < RESEARCH_INTENT_MIN_LENGTH || intent.length > RESEARCH_INTENT_MAX_LENGTH) {
    return {
      ok: false,
      error: `intent must be between ${RESEARCH_INTENT_MIN_LENGTH} and ${RESEARCH_INTENT_MAX_LENGTH} characters`,
    };
  }
  if (!(RESEARCH_MISSION_MODES as readonly unknown[]).includes(value.mode)) {
    return { ok: false, error: "invalid research mode" };
  }
  if (value.modeSource !== "auto" && value.modeSource !== "user") {
    return { ok: false, error: "invalid mode source" };
  }
  const rawDeliverable = typeof value.deliverable === "string" ? value.deliverable : "";
  const deliverable = rawDeliverable.trim();
  if (deliverable.includes("\0")) {
    return { ok: false, error: "deliverable contains an invalid NUL character" };
  }
  if (hasUnpairedUtf16Surrogate(rawDeliverable)) {
    return { ok: false, error: "deliverable contains invalid Unicode" };
  }
  if (!deliverable || deliverable.length > RESEARCH_DELIVERABLE_MAX_LENGTH) {
    return {
      ok: false,
      error: `deliverable must be between 1 and ${RESEARCH_DELIVERABLE_MAX_LENGTH} characters`,
    };
  }
  const bounds = normalizeResearchBounds(
    value.bounds && typeof value.bounds === "object"
      ? value.bounds as Partial<ResearchBounds>
      : {},
  );
  if (!bounds.ok) return { ok: false, error: bounds.reason };
  if (value.constraints !== undefined && !Array.isArray(value.constraints)) {
    return { ok: false, error: "constraints must be an array of strings" };
  }
  const rawConstraints = value.constraints ?? [];
  if (rawConstraints.length > RESEARCH_CONSTRAINT_MAX_COUNT) {
    return {
      ok: false,
      error: `constraints must contain at most ${RESEARCH_CONSTRAINT_MAX_COUNT} items`,
    };
  }
  if (rawConstraints.some((item) => typeof item !== "string")) {
    return { ok: false, error: "constraints must be an array of strings" };
  }
  const constraints: string[] = [];
  for (const rawConstraint of rawConstraints as string[]) {
    if (rawConstraint.includes("\0")) {
      return { ok: false, error: "constraint contains an invalid NUL character" };
    }
    if (hasUnpairedUtf16Surrogate(rawConstraint)) {
      return { ok: false, error: "constraint contains invalid Unicode" };
    }
    const constraint = rawConstraint.trim();
    if (constraint.length > RESEARCH_CONSTRAINT_MAX_LENGTH) {
      return {
        ok: false,
        error: `each constraint must be at most ${RESEARCH_CONSTRAINT_MAX_LENGTH} characters`,
      };
    }
    if (constraint) constraints.push(constraint);
  }
  const optionalText = (field: "title" | "audience" | "projectRoot", max: number) => {
    const raw = value[field];
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (
      typeof raw !== "string"
      || raw.includes("\0")
      || hasUnpairedUtf16Surrogate(raw)
    ) return null;
    const trimmed = raw.trim();
    if (trimmed.length > max) return null;
    return trimmed || undefined;
  };
  const title = optionalText("title", RESEARCH_TITLE_MAX_LENGTH);
  const audience = optionalText("audience", RESEARCH_AUDIENCE_MAX_LENGTH);
  const projectRoot = optionalText("projectRoot", RESEARCH_PROJECT_ROOT_MAX_LENGTH);
  if (title === null) {
    return { ok: false, error: `title must be valid Unicode text without NUL and at most ${RESEARCH_TITLE_MAX_LENGTH} characters` };
  }
  if (audience === null) {
    return { ok: false, error: `audience must be valid Unicode text without NUL and at most ${RESEARCH_AUDIENCE_MAX_LENGTH} characters` };
  }
  if (projectRoot === null) {
    return { ok: false, error: `projectRoot must be valid Unicode text without NUL and at most ${RESEARCH_PROJECT_ROOT_MAX_LENGTH} characters` };
  }
  // An unknown harness is REFUSED rather than quietly replaced with the
  // default: a mission that silently ran on a different runtime than the caller
  // asked for is the lock-in this field exists to remove, wearing a friendlier
  // face. Omitting the field is the only way to accept the default.
  const rawHarness = value.harness;
  let harness: string | undefined;
  if (rawHarness !== undefined && rawHarness !== null && rawHarness !== "") {
    if (
      typeof rawHarness !== "string"
      || !(RESEARCH_HARNESS_IDS as readonly string[]).includes(rawHarness)
    ) {
      return {
        ok: false,
        error: `harness must be one of: ${RESEARCH_HARNESS_IDS.join(", ")}`,
      };
    }
    harness = rawHarness;
  }
  const rawModel = value.model;
  let model: string | undefined;
  if (rawModel !== undefined && rawModel !== null && rawModel !== "") {
    if (
      typeof rawModel !== "string"
      || rawModel.includes("\0")
      || hasUnpairedUtf16Surrogate(rawModel)
      || rawModel.trim().length > RESEARCH_MODEL_MAX_LENGTH
    ) {
      return {
        ok: false,
        error: `model must be valid Unicode text without NUL and at most ${RESEARCH_MODEL_MAX_LENGTH} characters`,
      };
    }
    // A flag-shaped model would be read as an option by the harness CLI rather
    // than as its value, so refuse it at the boundary instead of building argv
    // that means something else.
    if (rawModel.trim().startsWith("-")) {
      return { ok: false, error: "model must not begin with '-'" };
    }
    model = rawModel.trim();
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
      ...(harness ? { harness } : {}),
      ...(model ? { model } : {}),
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
/**
 * One short meta line per display phase, for the Desk stepper.
 *
 * The handoff prints a second line under each phase node ("12/12 src",
 * "your turn") so the stepper reports progress rather than only position.
 * Every string here is read off the mission — counts, statuses, the
 * checkpoint state — so a phase with nothing to report says "—" instead of
 * inventing a number.
 */
export function researchPhaseMeta(
  mission: Pick<ResearchMission, "status" | "bounds" | "sources" | "artifacts" | "iterations">,
  phaseIds: readonly string[],
): string[] {
  const statuses = researchPhaseStatuses(mission, phaseIds);
  const counts = researchSourceStatusCounts(mission.sources);
  const artifacts = mission.artifacts.filter((artifact) => artifact.state !== "rejected").length;
  return phaseIds.map((phase, index) => {
    const status = statuses[index];
    if (phase === "scope") {
      return status === "succeeded" ? "bounds set" : status === "running" ? "framing…" : "—";
    }
    if (phase === "gather") {
      if (status === "pending") return "—";
      // A zero target is a real (if legacy) bound. "3/0 src" reads as a broken
      // divide, so report the count alone when there is nothing to divide by.
      return mission.bounds.sourceTarget > 0
        ? `${mission.sources.length}/${mission.bounds.sourceTarget} src`
        : `${mission.sources.length} src`;
    }
    if (phase === "challenge") {
      if (status === "failed") return "stopped here";
      if (counts.conflicting > 0) {
        return `${counts.conflicting} conflicting`;
      }
      return status === "succeeded" ? "verified" : status === "running" ? "testing…" : "—";
    }
    if (phase === "synthesize") {
      if (status === "pending") return "—";
      return artifacts > 0 ? `${artifacts} artifact${artifacts === 1 ? "" : "s"}` : "drafting…";
    }
    if (phase === "control") {
      if (mission.status === "checkpoint") return "your turn";
      return status === "succeeded" ? "approved" : "—";
    }
    if (phase === "publish") {
      const published = mission.artifacts.filter((artifact) => artifact.state === "published").length;
      if (published > 0) return `${published} published`;
      // A succeeded publish phase with nothing published is a real state (the
      // run finished without promoting an artifact). "shipped" would claim
      // something went out; say what actually happened instead.
      return status === "succeeded" ? "none published" : "gated";
    }
    return "—";
  });
}

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

/** Per-status source tallies for the evidence ledger's triage filters. */
export function researchSourceStatusCounts(
  sources: ReadonlyArray<Pick<ResearchSourceRef, "status">>,
): Record<ResearchSourceRef["status"], number> {
  const counts: Record<ResearchSourceRef["status"], number> = {
    candidate: 0,
    used: 0,
    conflicting: 0,
    rejected: 0,
  };
  for (const source of sources) counts[source.status] += 1;
  return counts;
}

export type ResearchContinueLabel = {
  /** Compact button text in the desk's iN/M vocabulary. */
  label: string;
  /** Full-sentence consequence for the button's aria-label and title. */
  description: string;
  /** A stop gate already refuses the next iteration — pressing starts nothing. */
  gated: boolean;
};

/**
 * What pressing Continue will actually do.
 *
 * The runner gates every new iteration on stopBeforeNextIteration
 * (src/lib/server/research-mission-runner.ts): iteration count, wall-clock
 * budget, missing-cost policy, and the reported-spend cap. A Continue past
 * any of those starts nothing — it re-settles the mission at the limit. This
 * mirrors those gates (same >= comparisons) so the button can say which gate
 * refuses instead of promising an iteration; keep the two in sync. Even when
 * no gate is known-exceeded, the description stays a request — the runner
 * re-checks with live clocks.
 */
export function researchContinueLabel(
  mission: Pick<ResearchMission, "iterations" | "bounds" | "startedAt">,
  nowMs: number = Date.now(),
): ResearchContinueLabel {
  const next = mission.iterations.length + 1;
  const max = mission.bounds.maxIterations;
  const label = `Continue (i${next}/${max})`;
  const refusal = (why: string) => ({
    label,
    description: `Continue would ask for iteration ${next}, but ${why}`,
    gated: true,
  });
  if (next > max) {
    return {
      label,
      description: `Continue would ask for iteration ${next}, past the planned ${max} — the runner stops at the iteration limit instead of starting it.`,
      gated: true,
    };
  }
  const startedAt = mission.startedAt ? Date.parse(mission.startedAt) : Number.NaN;
  if (Number.isFinite(startedAt) && nowMs - startedAt >= mission.bounds.wallClockMinutes * 60_000) {
    return refusal(`the ${mission.bounds.wallClockMinutes}-minute wall-clock budget is spent — the runner pauses at the limit instead of starting it.`);
  }
  if (
    mission.bounds.stopWhenCostUnavailable &&
    mission.iterations.some((iteration) => iteration.finishedAt && iteration.costUsd === undefined)
  ) {
    return refusal("an iteration finished without reporting cost — the runner pauses for review instead of starting it.");
  }
  const reportedSpend = mission.iterations
    .map((iteration) => iteration.costUsd)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  if (mission.bounds.maxSpendUsd !== undefined && reportedSpend >= mission.bounds.maxSpendUsd) {
    return refusal(`reported spend has reached the $${mission.bounds.maxSpendUsd} cap — the runner pauses at the limit instead of starting it.`);
  }
  return {
    label,
    description: `Continue asks the runner to start iteration ${next} of ${max} planned — stop gates are re-checked first.`,
    gated: false,
  };
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
  /**
   * Fraction of the bound consumed, clamped to 0–1, for the reading's meter
   * bar. Present only where a denominator genuinely exists: a spend with no
   * cap and the checkpoint cadence have nothing to be a fraction *of*, so they
   * carry no bar rather than a bar that means nothing (the value text still
   * says everything). Past a stop gate it pins at 1 while `tone` says "over".
   */
  progress?: number;
};

/** Clamp a ratio into 0–1; a zero or absent denominator yields no bar. */
function boundProgress(used: number, total: number): number | undefined {
  if (!Number.isFinite(total) || total <= 0) return undefined;
  return Math.max(0, Math.min(1, used / total));
}

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
  mission: Pick<ResearchMission, "status" | "bounds" | "sources" | "iterations" | "startedAt" | "finishedAt" | "updatedAt">,
  nowMs: number = Date.now(),
): ResearchBoundReading[] {
  const { bounds } = mission;
  // The wall-clock stop gate compares now - startedAt (stopBeforeNextIteration),
  // so an unfinished mission's clock keeps running between data refreshes:
  // measure it against now, and freeze at finishedAt (or the last write, for
  // settled missions that never recorded one) only once the run is over.
  const settled = ["completed", "failed", "cancelled", "archived"].includes(mission.status);
  const clockEndMs = mission.finishedAt
    ? Date.parse(mission.finishedAt)
    : settled
      ? Date.parse(mission.updatedAt)
      : nowMs;
  const elapsedMs = mission.startedAt ? Math.max(0, clockEndMs - Date.parse(mission.startedAt)) : 0;
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
      ...(bounds.maxSpendUsd === undefined
        ? {}
        : { progress: boundProgress(reportedCost, bounds.maxSpendUsd) }),
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
      progress: boundProgress(elapsedMinutes, bounds.wallClockMinutes),
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
      progress: boundProgress(mission.sources.length, bounds.sourceTarget),
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
