import type { ConversationFile } from "../cave-conversations.ts";
import type { FlowDoc } from "../flow/flow-doc.ts";
import type { FlowRunRecord } from "../flows.ts";
import type { AutomationRunRecord } from "../automation-runs.ts";
import { hasUnpairedUtf16Surrogate } from "../utf16.ts";
import { daemonSessionAlreadyGone } from "./daemon-session-error.ts";
import type { KnowledgeEntry } from "./knowledge-vault.ts";
import {
  normalizeResearchSource,
  parseResearchControl,
  renderSourceLedgerMarkdown,
  researchKnowledgeEntry,
  type ResearchProvenance,
  validateResearchArtifactContent,
} from "../research-artifact-contract.ts";
import { buildResearchMissionFlow } from "../research-mission-flow.ts";
import {
  allowedResearchActions,
  RESEARCH_DIRECTION_MAX_LENGTH,
  RESEARCH_PROJECT_ROOT_MAX_LENGTH,
  researchArtifactKindForMode,
  STANDARD_RESEARCH_ARTIFACTS,
  type CreateResearchMissionInput,
  type ResearchArtifactRef,
  type ResearchMission,
  type ResearchMissionActionInput,
  type ResearchAutomationLink,
  type ResearchSourcePatch,
  type ResearchSourceRef,
  validateCreateResearchMissionInput,
} from "../research-missions.ts";
import {
  parseResearchSessionAuthority,
  type ResearchSessionAuthority,
  type ResearchSessionOwnerKind,
} from "./research-session-authority.ts";
import {
  RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC,
  assertResearchSessionOwnerOutsideWriteRoots,
  createResearchMissionWorkspace,
  clearResearchMissionSessionOwner,
  listResearchMissions,
  loadResearchMission,
  loadResearchMissionSessionOwner,
  readValidatedMissionFile,
  recordResearchMissionSessionOwner,
  researchMissionWorkspacePath,
  saveResearchMission,
  type ResearchMissionSessionOwner,
} from "./research-mission-store.ts";
import { withResearchMissionActionLock } from "./research-mission-lock.ts";
import {
  applyStartResult,
  createMissionRecord,
  stopBeforeNextIteration,
  withinStartupGrace,
  type ResearchFlowStartResult,
} from "./research-mission-lifecycle.ts";

export {
  withinStartupGrace,
} from "./research-mission-lifecycle.ts";
export type { ResearchFlowStartResult } from "./research-mission-lifecycle.ts";

export const RESEARCH_SESSION_OWNER_REPAIR_REQUIRED =
  "The owned Research session was stopped, but its mission record is missing or unreadable. Cave retained the private session owner for repair.";
export const RESEARCH_ACTIVE_SESSION_OWNER_CONFLICT =
  "Research still has an active private session owner. Cancel it before changing mission state.";

/**
 * The mission record is already durable when this is thrown. The HTTP layer
 * can therefore preserve a typed 400/413 response without losing the failed,
 * retryable mission that explains what the user must change.
 */
export class ResearchMissionLaunchInputError extends Error {
  readonly status: 400 | 413;
  readonly mission: ResearchMission;

  constructor(status: 400 | 413, mission: ResearchMission, message: string) {
    super(message);
    this.name = "ResearchMissionLaunchInputError";
    this.status = status;
    this.mission = mission;
  }
}

/**
 * Settled mission statuses — mirrors the settled set in
 * src/lib/research-missions.ts (researchBoundReadings): a mission in one of
 * these states must never be transitioned by background reconciliation.
 */
const TERMINAL_RESEARCH_MISSION_STATUSES: ReadonlyArray<ResearchMission["status"]> = [
  "completed",
  "failed",
  "cancelled",
  "archived",
];

/**
 * How long a non-terminal mission may reference a missing, never-launched, or
 * stuck-queued run before reconcile recovers it as failed (so Retry becomes
 * available). Within the window the run may still land — travel replay records
 * a replayed run late, and a startup save may still be in flight. Measured
 * against deps.now() so tests can drive the clock.
 */
export const RESEARCH_RUN_RECOVERY_GRACE_MS = 10 * 60_000;

export type ResearchAutomationScheduleInput = {
  rrule: string;
  model?: string;
  reasoningEffort?: string;
  executionEnvironment?: string;
  skillPath?: string | null;
};

type ResearchAutomationRecord = Pick<ResearchAutomationLink, "id" | "status"> & {
  rrule: string | null;
};

type ResearchAutomationCreateInput = {
  name: string;
  rrule: string;
  prompt: string;
  cwds: string[];
  tags: string[];
  familiars: string[];
  model: string;
  reasoningEffort: string;
  executionEnvironment: string;
  skillPath: string | null;
};

export type ResearchMissionRunnerDeps = {
  createWorkspace(mission: ResearchMission): Promise<ResearchMission>;
  loadMission(id: string): Promise<ResearchMission | null>;
  saveMission(mission: ResearchMission): Promise<void>;
  loadSessionOwner(missionId: string): Promise<ResearchMissionSessionOwner | null>;
  recordSessionOwner(owner: ResearchMissionSessionOwner): Promise<void>;
  clearSessionOwner(
    owner: Pick<ResearchMissionSessionOwner, "missionId" | "iteration" | "sessionId">,
  ): Promise<void>;
  assertSessionOwnerPrivate(writeRoots: string[]): Promise<void>;
  startFlow(
    flow: FlowDoc,
    options: {
      projectRoot: string | null;
      addDirs?: string[];
      offlinePolicy?: "queue" | "reject";
      /** Mission-selected runtime; overrides the familiar's Coven binding. */
      harness?: string;
      model?: string;
      publishSessionOwner?: (
        sessionId: string,
        ownerKind: ResearchSessionOwnerKind,
        authority?: ResearchSessionAuthority,
      ) => Promise<() => Promise<void>>;
    },
  ): Promise<ResearchFlowStartResult>;
  loadFlowRun(id: string): Promise<FlowRunRecord | null>;
  loadConversation(sessionId: string): Promise<ConversationFile | null>;
  /**
   * Liveness of the agent session carrying the current iteration:
   * - "running": still working — leave the mission running.
   * - "finished": exited cleanly — reconcile from its transcript now (the
   *   flow-run record alone never flips, so without this probe a finished
   *   iteration reads "running" forever — cave-ibb7).
   * - "gone": died, was killed, or the daemon no longer knows it — the
   *   mission fails with Retry enabled instead of hanging.
   * - "unknown": can't tell (daemon unreachable) — change nothing.
   */
  sessionState(
    sessionId: string,
    authority?: ResearchSessionAuthority,
    ownerKind?: ResearchMissionSessionOwner["ownerKind"],
  ): Promise<"running" | "finished" | "gone" | "unknown">;
  /** Best transcript available for a flow session (conversation → JSONL → daemon events). */
  readSessionTranscript(
    sessionId: string,
    authority?: ResearchSessionAuthority,
    ownerKind?: ResearchMissionSessionOwner["ownerKind"],
  ): Promise<string>;
  readMissionFile(id: string, relativePath: string): Promise<string | null>;
  readSources(id: string): Promise<ResearchSourceRef[]>;
  publishKnowledge(entry: KnowledgeEntry): Promise<KnowledgeEntry>;
  killSession(
    sessionId: string,
    authority?: ResearchSessionAuthority,
    ownerKind?: ResearchMissionSessionOwner["ownerKind"],
  ): Promise<void>;
  createAutomation(input: ResearchAutomationCreateInput): Promise<ResearchAutomationRecord>;
  getAutomation(id: string): Promise<ResearchAutomationRecord | null>;
  updateAutomation(
    id: string,
    patch: { status?: "ACTIVE" | "PAUSED" },
  ): Promise<ResearchAutomationRecord | null>;
  latestAutomationRun(id: string): Promise<AutomationRunRecord | null>;
  readAutomationTranscript(run: AutomationRunRecord): Promise<string>;
  readAutomationCheckpoint(id: string): Promise<{ transcript: string; token: string; at: string }>;
  fingerprintMission(id: string): Promise<string>;
  missionWorkspacePath(id: string): string;
  /** Resolve a candidate project root to a normalized allowed path, or null. */
  resolveProjectRoot(root: string): Promise<string | null>;
  /**
   * Run-start preflight: make sure the mission's familiar can reach the
   * standard research landing root (where every mission workspace lives), so
   * finished research is visible from the familiar's later sessions without a
   * manual grant. Best-effort by contract — implementations MUST NOT throw; a
   * failed grant degrades to results that land but aren't chat-reachable.
   */
  ensureResearchAccess(familiarId: string): Promise<void>;
  /**
   * Familiar-level access check for a configured project root at run start.
   * Returns an actionable error message when the root is a registered project
   * the familiar cannot use; null when access is fine (including
   * allowed-but-unregistered roots such as the mission workspace).
   */
  checkFamiliarRootAccess(familiarId: string, projectRoot: string): Promise<string | null>;
  now(): Date;
  randomId(): string;
};

function automationPrompt(mission: ResearchMission, workspace: string): string {
  return [
    `Continue research mission ${mission.id}: ${mission.title}`,
    `Work only inside ${workspace}.`,
    "Perform exactly one bounded research iteration, then stop.",
    `Respect the mission limits: ${mission.bounds.maxIterations} total iterations, ${mission.bounds.wallClockMinutes} wall-clock minutes, ${mission.bounds.sourceTarget} target sources${mission.bounds.maxSpendUsd === undefined ? "" : `, $${mission.bounds.maxSpendUsd} reported spend`}.`,
    "Read mission.json and the existing research-state.yaml, findings.md, research-log.md, sources.json, and artifacts before acting.",
    "Update the workspace files atomically enough that the resulting checkpoint is internally consistent.",
    "As the final file write, replace automation-checkpoint.txt with a unique ISO timestamp line followed by the same three control lines required below.",
    "Do not create or modify schedules. Do not start another iteration.",
    "Finish stdout with these three bare lines, substituting a valid single-line JSON object:",
    "@@research-control",
    '{"decision":"checkpoint","reason":"what changed and why","confidence":0.8}',
    "@@research-artifacts-written",
  ].join("\n");
}

function conversationTranscript(conversation: ConversationFile | null): string {
  return (conversation?.turns ?? [])
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.text)
    .join("\n");
}

function conversationCost(conversation: ConversationFile | null): number | undefined {
  const reported = (conversation?.turns ?? [])
    .map((turn) => turn.costUsd)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (reported.length === 0) return undefined;
  return reported.reduce((sum, value) => sum + value, 0);
}

function mergeResearchSource(
  sources: ResearchSourceRef[],
  source: ResearchSourceRef,
): ResearchSourceRef[] {
  const index = sources.findIndex((item) => (
    source.url && item.url === source.url
  ) || (
    source.localPath && item.localPath === source.localPath
  ) || item.id === source.id);
  if (index < 0) return [source, ...sources];
  return sources.map((item, itemIndex) => itemIndex === index ? {
    ...item,
    ...source,
    id: item.id,
  } : item);
}

/**
 * Merge the flow-written sources.json ledger into the stored mission sources
 * instead of replacing them: manually attached sources live only in
 * mission.json (attach-source), so a wholesale replace silently wiped them on
 * every settle. File entries win on url/localPath/id collision; manual-only
 * entries survive.
 */
function mergeFileSources(
  stored: ResearchSourceRef[],
  file: ResearchSourceRef[],
): ResearchSourceRef[] {
  const matchesFileEntry = (item: ResearchSourceRef) => file.some((source) => (
    source.url && item.url === source.url
  ) || (
    source.localPath && item.localPath === source.localPath
  ) || source.id === item.id);
  return [...file, ...stored.filter((item) => !matchesFileEntry(item))];
}

const PATCHABLE_SOURCE_FIELDS = [
  "title", "publisher", "publishedAt", "sourceType", "claim", "note", "confidence", "status",
] as const satisfies ReadonlyArray<keyof ResearchSourcePatch>;

const PATCHABLE_TEXT_LIMITS: Record<string, number> = {
  title: 300,
  publisher: 200,
  publishedAt: 100,
  sourceType: 100,
  claim: 2_000,
  note: 2_000,
};

function patchResearchSource(
  mission: ResearchMission,
  sourceId: string,
  patch: ResearchSourcePatch,
): ResearchMission {
  // The route forwards the patch body verbatim, so allowlist hard: unknown
  // keys (url, id, addedAt, …) must never spread into the stored record —
  // url would bypass attach-time normalizeWebUrl and id would break dedupe.
  const raw = patch as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter(
    (key) => !(PATCHABLE_SOURCE_FIELDS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`invalid source patch field: ${unknownKeys[0]}`);
  }
  const validated: Partial<ResearchSourceRef> = {};
  for (const field of Object.keys(PATCHABLE_TEXT_LIMITS)) {
    if (!(field in raw)) continue;
    const value = raw[field];
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) throw new Error(`invalid source ${field}`);
    (validated as Record<string, string>)[field] = trimmed.slice(0, PATCHABLE_TEXT_LIMITS[field]);
  }
  if ("status" in raw) {
    const allowedStatuses: ResearchSourceRef["status"][] = [
      "candidate", "used", "conflicting", "rejected",
    ];
    if (!allowedStatuses.includes(raw.status as ResearchSourceRef["status"])) {
      throw new Error("invalid source status");
    }
    validated.status = raw.status as ResearchSourceRef["status"];
  }
  if ("confidence" in raw) {
    const confidence = raw.confidence;
    if (
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) || confidence < 0 || confidence > 1
    ) {
      throw new Error("invalid source confidence");
    }
    validated.confidence = confidence;
  }
  let found = false;
  const sources = mission.sources.map((source) => {
    if (source.id !== sourceId) return source;
    found = true;
    return { ...source, ...validated };
  });
  if (!found) throw new Error("research source not found");
  return { ...mission, sources };
}

type PublishFinalArtifactsArgs = {
  mission: ResearchMission;
  artifacts: ResearchArtifactRef[];
  sources: ResearchSourceRef[];
  /** Pre-read artifacts/primary.md content; null when unavailable. */
  primaryMarkdown: string | null;
  provenance: ResearchProvenance;
  deps: Pick<ResearchMissionRunnerDeps, "readMissionFile" | "publishKnowledge">;
};

/** Provenance stamped from the mission's most recent iteration. */
function latestIterationProvenance(mission: ResearchMission, generatedAt: string): ResearchProvenance {
  const lastIteration = mission.iterations.at(-1);
  return {
    missionId: mission.id,
    iteration: lastIteration?.number ?? mission.iterations.length,
    flowRunId: lastIteration?.flowRunId,
    sessionId: lastIteration?.sessionId,
    automationRunId: lastIteration?.automationRunId,
    generatedAt,
  };
}

/** Publish every unpublished, non-rejected ref. Per-artifact isolation: one
 *  failed vault write or missing file never blocks the others or the
 *  mission's terminal state — the failed ref stays `working` (retryable
 *  later) and is named in the returned failures. */
async function publishFinalArtifacts(
  args: PublishFinalArtifactsArgs,
): Promise<{ artifacts: ResearchArtifactRef[]; failures: string[] }> {
  const artifacts: ResearchArtifactRef[] = [];
  const failures: string[] = [];
  for (const artifact of args.artifacts) {
    if (artifact.state === "rejected" || artifact.knowledgeId) {
      artifacts.push(artifact);
      continue;
    }
    try {
      const markdown = artifact.relativePath === "artifacts/primary.md"
        ? args.primaryMarkdown
        : artifact.kind === "source-ledger"
          ? renderSourceLedgerMarkdown(args.sources)
          : await args.deps.readMissionFile(args.mission.id, artifact.relativePath);
      if (!markdown) throw new Error("file missing");
      const content = validateResearchArtifactContent(artifact.kind, markdown);
      if (!content.ok) throw new Error(content.reason);
      const entry = await args.deps.publishKnowledge(researchKnowledgeEntry({
        mission: args.mission,
        artifact,
        provenance: args.provenance,
        markdown: content.value,
      }));
      artifacts.push({ ...artifact, knowledgeId: entry.id, state: "published" });
    } catch (error) {
      failures.push(`${artifact.key}: ${error instanceof Error ? error.message : "publish failed"}`);
      artifacts.push(artifact);
    }
  }
  return { artifacts, failures };
}

const PUBLISH_FAILURE_PREFIX = "Artifact publish failed — ";

function publishFailureError(failures: string[]): string | undefined {
  return failures.length ? `${PUBLISH_FAILURE_PREFIX}${failures.join("; ")}` : undefined;
}

/**
 * Rebuild a publish-failure banner after the artifact set changes (a manual
 * publish succeeds, or a failed ref is rejected), keeping only the segments
 * whose ref is STILL unpublished-and-working — so the banner never keeps
 * naming an artifact that is now published or rejected, and clears entirely
 * once nothing publishable remains (cave-o780). The original per-ref reasons
 * are preserved by segment; a lastError that isn't ours is returned untouched.
 */
function rebuildPublishFailure(
  lastError: string | undefined,
  artifacts: ResearchArtifactRef[],
): string | undefined {
  if (!lastError?.startsWith(PUBLISH_FAILURE_PREFIX)) return lastError;
  const stillFailing = new Set(
    artifacts
      .filter((artifact) => artifact.state === "working" && !artifact.knowledgeId)
      .map((artifact) => artifact.key),
  );
  const remaining = lastError
    .slice(PUBLISH_FAILURE_PREFIX.length)
    .split("; ")
    .filter((segment) => stillFailing.has(segment.split(":")[0]?.trim() ?? ""));
  return remaining.length ? `${PUBLISH_FAILURE_PREFIX}${remaining.join("; ")}` : undefined;
}

const STANDARD_RESEARCH_ARTIFACT_KEYS = new Set(
  STANDARD_RESEARCH_ARTIFACTS.map((standard) => standard.key),
);
const STANDARD_RESEARCH_ARTIFACT_RELATIVE_PATHS = new Set(
  STANDARD_RESEARCH_ARTIFACTS.map((standard) => standard.relativePath),
);

/** True for the findings/source-ledger/research-log refs — matched by key or
 *  relativePath against STANDARD_RESEARCH_ARTIFACTS rather than duplicating
 *  those literals here. Never true for the primary lineage. */
function isStandardResearchArtifact(artifact: ResearchArtifactRef): boolean {
  return (
    STANDARD_RESEARCH_ARTIFACT_KEYS.has(artifact.key) ||
    STANDARD_RESEARCH_ARTIFACT_RELATIVE_PATHS.has(artifact.relativePath)
  );
}

async function reconcileCompletedRun(
  mission: ResearchMission,
  iterationIndex: number,
  deps: ResearchMissionRunnerDeps,
  transcriptOverride?: string,
  authoritativeSessionId?: string,
): Promise<ResearchMission> {
  const iteration = mission.iterations[iterationIndex];
  const sessionId = authoritativeSessionId ?? iteration.sessionId;
  // The conversation is loaded even when a transcript override is supplied:
  // the override only replaces the transcript TEXT — reported cost still
  // lives on the conversation turns and must keep feeding costUsd (and with
  // it stopWhenCostUnavailable / maxSpendUsd policy).
  const conversation = sessionId
    ? await deps.loadConversation(sessionId)
    : null;
  const costUsd = conversationCost(conversation);
  const timestamp = deps.now().toISOString();
  // A missing or unreadable primary artifact is an execution failure, not a
  // review checkpoint. A checkpoint means the agent completed a bounded pass
  // and left a reviewable draft behind. Without that draft (often alongside a
  // missing terminal control record), rendering it as a checkpoint falsely
  // turns every stale phase green and offers Continue instead of Retry.
  const failedIteration = {
    ...iteration,
    ...(sessionId ? { sessionId } : {}),
    status: "failed" as const,
    finishedAt: timestamp,
    summary: "Research output unavailable",
    ...(costUsd === undefined ? {} : { costUsd }),
  };
  const latestAssistant = [...(conversation?.turns ?? [])]
    .reverse()
    .find((turn) => turn.role === "assistant");
  if (latestAssistant?.isError) {
    // Direct-run transport, protocol, exit, and timeout failures are persisted
    // on the assistant turn. Even if partial output contains valid-looking
    // control markers or artifacts, it cannot turn that failed run into a
    // successful checkpoint. Keep diagnostics fixed and prompt-free.
    return {
      ...mission,
      status: "failed",
      updatedAt: timestamp,
      lastError: "Research session failed or timed out. Retry starts a fresh iteration.",
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? failedIteration : item),
    };
  }
  const control = parseResearchControl(transcriptOverride ?? conversationTranscript(conversation));
  const nextIteration = {
    ...iteration,
    ...(sessionId ? { sessionId } : {}),
    status: control.decision === "complete" ? "completed" as const : "checkpoint" as const,
    finishedAt: timestamp,
    decision: control.decision,
    decisionReason: control.reason,
    summary: control.reason,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
  let markdown: string | null;
  try {
    markdown = await deps.readMissionFile(mission.id, "artifacts/primary.md");
  } catch (error) {
    return {
      ...mission,
      status: "failed",
      updatedAt: timestamp,
      lastError: error instanceof Error ? error.message : "Research evidence could not be read",
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? failedIteration : item),
    };
  }

  let fileSources: ResearchSourceRef[];
  try {
    fileSources = await deps.readSources(mission.id);
  } catch (error) {
    // A primary draft exists but its ledger needs repair. Keep this as a
    // checkpoint: the user can inspect the draft and correct/reject evidence
    // instead of discarding a useful pass as an execution failure.
    return {
      ...mission,
      status: "checkpoint",
      updatedAt: timestamp,
      lastError: error instanceof Error ? error.message : "Research sources could not be read",
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? nextIteration : item),
    };
  }
  const sources = mergeFileSources(mission.sources, fileSources);

  if (!markdown) {
    return {
      ...mission,
      status: "failed",
      updatedAt: timestamp,
      lastError: "Research run completed without artifacts/primary.md",
      sources,
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? failedIteration : item),
    };
  }
  // Primary lookup by path, not index — backfilled legacy arrays and the
  // reject flow's prepended working copies both keep this stable.
  const primaryArtifact = mission.artifacts.find(
    (artifact) => artifact.relativePath === "artifacts/primary.md" && artifact.state !== "rejected",
  );
  const content = validateResearchArtifactContent(
    primaryArtifact?.kind ?? researchArtifactKindForMode(mission.mode),
    markdown,
  );
  if (!content.ok) {
    return {
      ...mission,
      status: "checkpoint",
      updatedAt: timestamp,
      lastError: content.reason,
      sources,
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? nextIteration : item),
    };
  }

  // Every pass through the normal evidence path bumps every live ref — the
  // standard files are rewritten by each run just like the primary.
  let artifacts = mission.artifacts.map((artifact) => (
    artifact.state === "rejected" ? artifact : { ...artifact, iteration: iteration.number, updatedAt: timestamp }
  ));
  let publishFailures: string[] = [];
  if (control.decision === "complete") {
    const outcome = await publishFinalArtifacts({
      mission,
      artifacts,
      sources,
      primaryMarkdown: content.value,
      provenance: {
        missionId: mission.id,
        iteration: iteration.number,
        flowRunId: iteration.flowRunId,
        sessionId,
        automationRunId: iteration.automationRunId,
        generatedAt: timestamp,
      },
      deps,
    });
    artifacts = outcome.artifacts;
    publishFailures = outcome.failures;
  }

  return {
    ...mission,
    status: control.decision === "complete" ? "completed" : "checkpoint",
    updatedAt: timestamp,
    ...(control.decision === "complete" ? { finishedAt: timestamp } : {}),
    lastError: publishFailureError(publishFailures),
    sources,
    artifacts,
    iterations: mission.iterations.map((item, index) => index === iterationIndex ? nextIteration : item),
  };
}

export function makeResearchMissionRunner(deps: ResearchMissionRunnerDeps) {
  let reconcileFlowUnlocked: (mission: ResearchMission) => Promise<ResearchMission>;
  /**
   * A mission directory deleted mid-flight surfaces as ENOENT from the store —
   * report the standard not-found error (the actions route maps it to 404)
   * instead of leaking a raw fs failure as a 500.
   */
  const saveMission = async (mission: ResearchMission): Promise<void> => {
    try {
      await deps.saveMission(mission);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new Error("research mission not found");
      }
      throw error;
    }
  };
  const saveUpdated = async (mission: ResearchMission): Promise<ResearchMission> => {
    const updated = { ...mission, updatedAt: deps.now().toISOString() };
    await saveMission(updated);
    return updated;
  };

  /**
   * Persist the launch result or compensate the newly-started owner before
   * returning. A mission must never lose the only session id while its child or
   * daemon session keeps running merely because the final JSON write failed.
   */
  const persistLaunchResult = async (
    beforeResult: ResearchMission,
    result: ResearchFlowStartResult,
  ): Promise<ResearchMission> => {
    const recordedAt = deps.now();
    const applied = applyStartResult(beforeResult, result, recordedAt);
    const sessionId = result.sessionId ?? result.run?.sessionId;
    const iteration = applied.iterations.at(-1)?.number;
    const owner = result.sessionOwnerKind && sessionId && iteration
      ? {
          missionId: beforeResult.id,
          iteration,
          sessionId,
          ownerKind: result.sessionOwnerKind,
          ...(result.sessionAuthority ? { authority: result.sessionAuthority } : {}),
          recordedAt: recordedAt.toISOString(),
        } satisfies ResearchMissionSessionOwner
      : null;
    let ownerRecorded = false;
    try {
      if (owner) {
        await deps.recordSessionOwner(owner);
        ownerRecorded = true;
      }
      await saveMission(applied);
      if (!result.ok && (result.status === 400 || result.status === 413)) {
        throw new ResearchMissionLaunchInputError(
          result.status,
          applied,
          result.error || "Research launch input was rejected",
        );
      }
      return applied;
    } catch (saveError) {
      if (saveError instanceof ResearchMissionLaunchInputError) throw saveError;
      // A failed start can still carry a live owned session when its first
      // cleanup attempt was unconfirmed. Treat that exactly like a successful
      // launch whose result write failed: retry termination before allowing
      // the only durable session id to disappear with this exception.
      if (!result.ok && !(result.cleanupUnconfirmed && sessionId)) throw saveError;
      if (!sessionId) {
        throw new AggregateError(
          [saveError],
          "Research launch state could not be saved and no session owner was returned for cleanup",
        );
      }

      let cleanupError: unknown = null;
      try {
        await (result.cleanupSession
          ? result.cleanupSession()
          : deps.killSession(sessionId, result.sessionAuthority, result.sessionOwnerKind));
        if (ownerRecorded && owner) {
          await deps.clearSessionOwner(owner);
          ownerRecorded = false;
        }
      } catch (error) {
        cleanupError = error;
      }

      // A private owner is mandatory for direct Copilot and privileged local
      // daemon sessions. If it could not be recorded and cleanup also could
      // not be proved, never persist attacker-writable mission.json as the only
      // remaining handle.
      if (owner && !ownerRecorded && cleanupError !== null) {
        throw new AggregateError(
          [saveError, cleanupError],
          "Research session ownership could not be recorded or safely cleaned up",
        );
      }

      const recoveryResult: ResearchFlowStartResult = cleanupError === null
        ? {
            ok: false,
            error: "The Research session was stopped because Cave could not save its launch state. Retry starts a fresh iteration.",
          }
        : {
            ok: false,
            sessionId,
            ...(result.sessionAuthority ? { sessionAuthority: result.sessionAuthority } : {}),
            ...(result.sessionOwnerKind ? { sessionOwnerKind: result.sessionOwnerKind } : {}),
            cleanupUnconfirmed: true,
            error: "Cave could not save the Research launch state or confirm session cleanup. Cancel this owned session before retrying.",
          };
      const recovered = applyStartResult(beforeResult, recoveryResult, deps.now());
      try {
        await saveMission(recovered);
      } catch (recoverySaveError) {
        throw new AggregateError(
          cleanupError === null
            ? [saveError, recoverySaveError]
            : [saveError, cleanupError, recoverySaveError],
          cleanupError === null
            ? "Research session cleanup succeeded, but its failed launch state could not be saved"
            : "Research launch state and cleanup could not be confirmed or saved",
        );
      }
      return recovered;
    }
  };

  const assertNoActiveSessionOwner = async (missionId: string): Promise<void> => {
    if (await deps.loadSessionOwner(missionId)) {
      throw new Error(RESEARCH_ACTIVE_SESSION_OWNER_CONFLICT);
    }
  };

  /**
   * Resolve the project root an iteration will run in before any session is
   * spawned. A configured-but-unallowed root fails fast with an actionable
   * message (the flow executor would only say "invalid project root"); the
   * default mission workspace always resolves. Every start path (create,
   * next iteration, retry) routes through here, so this is also where run
   * preflight lives: the familiar's standard-landing grant is ensured, and a
   * configured registered root the familiar cannot use is refused before a
   * session is spent.
   */
  const missionStartTarget = async (
    mission: ResearchMission,
  ): Promise<
    { ok: true; projectRoot: string; missionWorkspace: string }
    | { ok: false; error: string }
  > => {
    // Standard landing access: research artifacts always land in the mission
    // workspace under the research landing root — make sure the mission's
    // familiar can reach them from later sessions before this run produces
    // anything. Best-effort by contract: implementations never throw.
    await deps.ensureResearchAccess(mission.familiarId);
    const workspacePath = deps.missionWorkspacePath(mission.id);
    const workspace = await deps.resolveProjectRoot(workspacePath) ?? workspacePath;
    if (mission.projectRoot) {
      const resolved = await deps.resolveProjectRoot(mission.projectRoot);
      if (!resolved) {
        return {
          ok: false,
          error: `Project root "${mission.projectRoot}" is not an allowed project path. Retry in the mission workspace, or set a valid root (an existing Cave project or workspace folder).`,
        };
      }
      const denied = await deps.checkFamiliarRootAccess(mission.familiarId, resolved);
      if (denied) return { ok: false, error: denied };
      try {
        await deps.assertSessionOwnerPrivate([resolved, workspace]);
      } catch {
        return { ok: false, error: RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC };
      }
      return { ok: true, projectRoot: resolved, missionWorkspace: workspace };
    }
    try {
      await deps.assertSessionOwnerPrivate([workspace]);
    } catch {
      return { ok: false, error: RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC };
    }
    return { ok: true, projectRoot: workspace, missionWorkspace: workspace };
  };

  /**
   * Start options for one iteration. A configured project may be the research
   * context while artifacts still belong in Cave's canonical mission
   * workspace, so that verified workspace is the one narrow secondary grant.
   */
  const missionStartOptions = (
    missionId: string,
    iteration: number,
    projectRoot: string,
    missionWorkspace: string,
    runtime?: { harness?: string; model?: string },
  ): {
    projectRoot: string;
    addDirs: string[];
    offlinePolicy: "reject";
    harness?: string;
    model?: string;
    publishSessionOwner: (
      sessionId: string,
      ownerKind: ResearchSessionOwnerKind,
      authority?: ResearchSessionAuthority,
    ) => Promise<() => Promise<void>>;
  } => ({
    projectRoot,
    addDirs: missionWorkspace === projectRoot ? [] : [missionWorkspace],
    ...(runtime?.harness ? { harness: runtime.harness } : {}),
    ...(runtime?.model ? { model: runtime.model } : {}),
    // A queued Research iteration has no live session handle to terminate.
    // Replaying it after Cancel would revive work against a terminal mission.
    offlinePolicy: "reject",
    publishSessionOwner: async (sessionId, ownerKind, authority) => {
      const owner = {
        missionId,
        iteration,
        sessionId,
        ownerKind,
        ...(authority ? { authority } : {}),
        recordedAt: deps.now().toISOString(),
      } satisfies ResearchMissionSessionOwner;
      await deps.recordSessionOwner(owner);
      return () => deps.clearSessionOwner(owner);
    },
  });

  /**
   * Apply a retry-time project root override: a string is validated and
   * persisted, null/empty clears the configured root so the mission falls
   * back to its own workspace.
   */
  const applyProjectRootOverride = async (
    mission: ResearchMission,
    override: string | null,
  ): Promise<ResearchMission> => {
    if (override !== null && typeof override !== "string") {
      throw new Error("invalid project root override");
    }
    if (override?.includes("\0") || (override && hasUnpairedUtf16Surrogate(override))) {
      throw new Error("invalid project root override");
    }
    const trimmed = override?.trim() ?? "";
    if (!trimmed) return { ...mission, projectRoot: undefined };
    if (trimmed.length > RESEARCH_PROJECT_ROOT_MAX_LENGTH) {
      throw new Error("invalid project root override");
    }
    const resolved = await deps.resolveProjectRoot(trimmed);
    if (!resolved) {
      throw new Error(
        `Project root "${trimmed}" is not an allowed project path. Add it as a Cave project first, or leave it empty to use the mission workspace.`,
      );
    }
    return { ...mission, projectRoot: resolved };
  };

  const startNextIteration = async (mission: ResearchMission): Promise<ResearchMission> => {
    const stopReason = stopBeforeNextIteration(mission, deps.now());
    if (stopReason) {
      const atIterationLimit = stopReason === "Iteration limit reached";
      return saveUpdated({
        ...mission,
        status: atIterationLimit ? "completed" : "paused",
        ...(atIterationLimit ? { finishedAt: deps.now().toISOString() } : {}),
        lastError: stopReason,
      });
    }
    const number = mission.iterations.length + 1;
    const timestamp = deps.now().toISOString();
    const workingArtifact = mission.artifacts[0]?.state === "rejected" ? {
      ...mission.artifacts[0],
      key: `primary-i${number}`,
      state: "working" as const,
      rejectionReason: undefined,
      iteration: number,
      updatedAt: timestamp,
    } : null;
    // The next pass rewrites every standard file (findings/source-ledger/
    // research-log) from scratch, so a rejected standard ref genuinely has a
    // fresh working version coming — recover it in place. Unlike the primary
    // lineage above, there is no per-iteration file for these, so no new
    // key/lineage entry is created; the same ref just returns to "working".
    const artifactsWithRecoveredStandardRefs = mission.artifacts.map((artifact) => (
      artifact.state === "rejected" && isStandardResearchArtifact(artifact) ? {
        ...artifact,
        state: "working" as const,
        rejectionReason: undefined,
        iteration: number,
        updatedAt: timestamp,
      } : artifact
    ));
    let next: ResearchMission = {
      ...mission,
      status: "planning",
      updatedAt: timestamp,
      finishedAt: undefined,
      lastError: undefined,
      iterations: [...mission.iterations, { number, status: "queued" }],
      artifacts: workingArtifact
        ? [workingArtifact, ...artifactsWithRecoveredStandardRefs]
        : artifactsWithRecoveredStandardRefs,
    };
    await assertNoActiveSessionOwner(next.id);
    await saveMission(next);
    const target = await missionStartTarget(next);
    const result = target.ok
      ? await deps.startFlow(
          buildResearchMissionFlow(next, number),
          missionStartOptions(next.id, number, target.projectRoot, target.missionWorkspace, next),
        )
      : { ok: false, error: target.error };
    return persistLaunchResult(next, result);
  };

  const pauseAutomation = async (
    mission: ResearchMission,
    reason: string,
  ): Promise<ResearchMission> => {
    if (!mission.automation) return mission;
    await deps.updateAutomation(mission.automation.id, { status: "PAUSED" });
    return {
      ...mission,
      automation: {
        ...mission.automation,
        status: "PAUSED",
        stopReason: reason,
      },
    };
  };

  const retryCurrentIteration = async (mission: ResearchMission): Promise<ResearchMission> => {
    const index = mission.iterations.length - 1;
    const current = mission.iterations[index];
    if (!current || current.status !== "failed") return mission;
    const timestamp = deps.now().toISOString();
    let retried: ResearchMission = {
      ...mission,
      status: "planning",
      finishedAt: undefined,
      lastError: undefined,
      updatedAt: timestamp,
      iterations: mission.iterations.map((iteration, iterationIndex) => iterationIndex === index ? {
        number: iteration.number,
        status: "queued",
      } : iteration),
    };
    await assertNoActiveSessionOwner(retried.id);
    await saveMission(retried);
    const target = await missionStartTarget(retried);
    const result = target.ok
      ? await deps.startFlow(
          buildResearchMissionFlow(retried, current.number),
          missionStartOptions(retried.id, current.number, target.projectRoot, target.missionWorkspace, retried),
        )
      : { ok: false, error: target.error };
    return persistLaunchResult(retried, result);
  };

  const act = (id: string, input: ResearchMissionActionInput): Promise<ResearchMission> => (
    withResearchMissionActionLock(id, async () => {
      const ownerBeforeLoad = input.action === "cancel"
        ? await deps.loadSessionOwner(id)
        : null;
      let mission: ResearchMission | null;
      try {
        mission = await deps.loadMission(id);
      } catch (error) {
        if (!ownerBeforeLoad) throw error;
        await deps.killSession(
          ownerBeforeLoad.sessionId,
          ownerBeforeLoad.authority,
          ownerBeforeLoad.ownerKind,
        );
        throw new Error(RESEARCH_SESSION_OWNER_REPAIR_REQUIRED);
      }
      if (!mission) {
        if (ownerBeforeLoad) {
          await deps.killSession(
            ownerBeforeLoad.sessionId,
            ownerBeforeLoad.authority,
            ownerBeforeLoad.ownerKind,
          );
          throw new Error(RESEARCH_SESSION_OWNER_REPAIR_REQUIRED);
        }
        throw new Error("research mission not found");
      }
      mission = await reconcileFlowUnlocked(mission);
      const sessionOwner = await deps.loadSessionOwner(id);
      const timestamp = deps.now().toISOString();

      if (sessionOwner && input.action !== "cancel") {
        throw new Error(RESEARCH_ACTIVE_SESSION_OWNER_CONFLICT);
      }

      if (input.action === "attach-source") {
        const normalized = normalizeResearchSource(input.source);
        if (!normalized.ok) throw new Error(normalized.reason);
        return saveUpdated({
          ...mission,
          sources: mergeResearchSource(mission.sources, normalized.value),
        });
      }
      if (input.action === "update-source") {
        return saveUpdated(patchResearchSource(mission, input.sourceId, input.patch));
      }
      if (input.action === "reject-artifact") {
        const reason = input.reason.trim().slice(0, 1_000);
        if (!reason) throw new Error("artifact rejection reason required");
        let found = false;
        const artifacts = mission.artifacts.map((artifact) => {
          if (artifact.key !== input.artifactKey) return artifact;
          found = true;
          return {
            ...artifact,
            state: "rejected" as const,
            rejectionReason: reason,
            updatedAt: timestamp,
          };
        });
        if (!found) throw new Error("research artifact not found");
        // Rejecting a ref makes it no longer publish-pending — rebuild any
        // publish-failure banner so it stops naming the rejected ref and
        // clears when that was the last publish-pending one (cave-o780).
        return saveUpdated({
          ...mission,
          artifacts,
          lastError: rebuildPublishFailure(mission.lastError, artifacts),
        });
      }
      if (input.action === "publish-artifact") {
        if (!["checkpoint", "completed", "failed"].includes(mission.status)) {
          throw new Error("research mission is not settled yet");
        }
        const artifact = mission.artifacts.find((item) => item.key === input.artifactKey);
        if (!artifact) throw new Error("research artifact not found");
        if (artifact.knowledgeId || artifact.state === "published") {
          throw new Error("research artifact already published");
        }
        if (artifact.state === "rejected") {
          throw new Error("rejected artifacts need a new working version before publishing");
        }
        const markdown = artifact.kind === "source-ledger"
          ? renderSourceLedgerMarkdown(mission.sources)
          : await deps.readMissionFile(mission.id, artifact.relativePath);
        if (!markdown) throw new Error("research artifact file missing");
        const content = validateResearchArtifactContent(artifact.kind, markdown);
        if (!content.ok) throw new Error(content.reason);
        const entry = await deps.publishKnowledge(researchKnowledgeEntry({
          mission,
          artifact,
          provenance: latestIterationProvenance(mission, timestamp),
          markdown: content.value,
        }));
        const artifacts = mission.artifacts.map((item) => (
          item.key === artifact.key
            ? { ...item, knowledgeId: entry.id, state: "published" as const, updatedAt: timestamp }
            : item
        ));
        // Rebuild the publish-failure banner from what's still unpublished:
        // retrying one artifact successfully must drop it from the banner (and
        // clear it entirely once nothing publishable is left), never keep
        // naming a now-published ref. A non-publish lastError is left alone.
        return saveUpdated({
          ...mission,
          artifacts,
          lastError: rebuildPublishFailure(mission.lastError, artifacts),
        });
      }

      if (!allowedResearchActions(mission).includes(input.action)
        && !(input.action === "cancel" && sessionOwner)) {
        return mission;
      }
      // A manual iteration would run concurrently with the linked ACTIVE
      // autoresearch schedule — two agents writing one mission workspace
      // (cave-7had). Require pausing the automation first.
      if (
        (input.action === "refine" || input.action === "continue") &&
        mission.automation?.status === "ACTIVE"
      ) {
        throw new Error("pause the linked automation before running manually");
      }
      if (input.action === "refine") {
        if (typeof input.direction !== "string") throw new Error("refined direction required");
        if (input.direction.includes("\0") || hasUnpairedUtf16Surrogate(input.direction)) {
          throw new Error("invalid refined direction");
        }
        const direction = input.direction.trim();
        if (!direction) throw new Error("refined direction required");
        if (direction.length > RESEARCH_DIRECTION_MAX_LENGTH) {
          throw new Error(`refined direction must be at most ${RESEARCH_DIRECTION_MAX_LENGTH} characters`);
        }
        mission = { ...mission, direction };
        return startNextIteration(mission);
      }
      if (input.action === "retry") {
        if (input.projectRoot !== undefined) {
          mission = await applyProjectRootOverride(mission, input.projectRoot);
        }
        return retryCurrentIteration(mission);
      }
      if (input.action === "continue") {
        return startNextIteration(mission);
      }
      if (input.action === "cancel") {
        const current = mission.iterations.at(-1);
        const currentActive = current?.status === "queued" || current?.status === "running";
        // A queued iteration can already carry a live session (travel handoff,
        // slow start) — kill whenever a session exists and the iteration has
        // not settled, not only when it reads "running".
        if (sessionOwner) {
          await deps.killSession(
            sessionOwner.sessionId,
            sessionOwner.authority,
            sessionOwner.ownerKind,
          );
        } else if (current?.sessionId && currentActive) {
          await deps.killSession(current.sessionId);
        }
        const cancelledMission = await pauseAutomation(mission, "Mission cancelled");
        const cancelled = await saveUpdated({
          ...cancelledMission,
          status: "cancelled",
          finishedAt: timestamp,
          // Only rewrite an iteration that is still in flight — a settled
          // (checkpoint/completed/failed) iteration keeps its real outcome.
          iterations: cancelledMission.iterations.map((iteration, index) => (
            index === cancelledMission.iterations.length - 1 &&
            (iteration.status === "queued" || iteration.status === "running")
              ? { ...iteration, status: "cancelled", finishedAt: timestamp }
              : iteration
          )),
        });
        if (sessionOwner) await deps.clearSessionOwner(sessionOwner);
        return cancelled;
      }
      if (input.action === "finish") {
        mission = await pauseAutomation(mission, "Mission finished");
        const finishedMission = mission;
        // Read the primary defensively. A symlinked/oversized/escaping primary
        // must NOT throw after pauseAutomation has changed the schedule state,
        // but it also cannot be treated as a completed research result. A
        // primary artifact is the deliverable that makes a Finish finalization
        // meaningful; without it, leave every ref un-published and offer Retry.
        let primaryMarkdown: string | null = null;
        let primaryError: string | null = null;
        try {
          primaryMarkdown = await deps.readMissionFile(finishedMission.id, "artifacts/primary.md");
        } catch (error) {
          primaryError = error instanceof Error ? error.message : "Research evidence could not be read";
        }
        if (!primaryMarkdown) {
          return saveUpdated({
            ...finishedMission,
            status: "failed",
            lastError: primaryError ?? "Research run completed without artifacts/primary.md",
            iterations: finishedMission.iterations.map((iteration, index) => {
              if (index !== finishedMission.iterations.length - 1) return iteration;
              const { decision: _decision, decisionReason: _decisionReason, ...failedIteration } = iteration;
              return {
                ...failedIteration,
                status: "failed" as const,
                finishedAt: timestamp,
                summary: "Research output unavailable",
              };
            }),
          });
        }
        // Finishing by hand saves the same final artifacts a `complete`
        // decision would — the checkpointed files are the deliverables.
        const outcome = await publishFinalArtifacts({
          mission: finishedMission,
          artifacts: finishedMission.artifacts.map((artifact) => (
            artifact.state === "rejected" ? artifact : { ...artifact, updatedAt: timestamp }
          )),
          sources: finishedMission.sources,
          primaryMarkdown,
          provenance: latestIterationProvenance(finishedMission, timestamp),
          deps,
        });
        return saveUpdated({
          ...finishedMission,
          status: "completed",
          finishedAt: timestamp,
          artifacts: outcome.artifacts,
          lastError: publishFailureError(outcome.failures),
        });
      }
      if (input.action === "archive") {
        mission = await pauseAutomation(mission, "Mission archived");
        return saveUpdated({ ...mission, status: "archived" });
      }
      if (input.action === "resume") {
        return saveUpdated({ ...mission, status: "checkpoint", lastError: undefined });
      }
      return mission;
    })
  );

  const pauseLinkedAutomation = async (
    mission: ResearchMission,
    run: AutomationRunRecord,
    reason: string,
    checkpoint?: { fingerprint: string; token?: string },
  ): Promise<ResearchMission> => {
    const automation = mission.automation;
    if (!automation) return mission;
    await deps.updateAutomation(automation.id, { status: "PAUSED" });
    const updated: ResearchMission = {
      ...mission,
      status: mission.status === "running" ? "checkpoint" : mission.status,
      updatedAt: deps.now().toISOString(),
      lastError: reason,
      automation: {
        ...automation,
        status: "PAUSED",
        lastRunId: run.id,
        lastRunStatus: run.status,
        lastRunAt: run.finishedAt ?? run.startedAt,
        stopReason: reason,
        ...(checkpoint ? { checkpointFingerprint: checkpoint.fingerprint } : {}),
        ...(checkpoint?.token ? { checkpointToken: checkpoint.token } : {}),
      },
    };
    await saveMission(updated);
    return updated;
  };

  const reconcileAutomationUnlocked = async (currentMission: ResearchMission): Promise<ResearchMission> => {
    // A private process owner outranks every agent-writable automation field.
    // In particular, reconcileFlowUnlocked may return a deliberately
    // non-persistable running projection while exact liveness is unknown after
    // a durable Cancel save. Automation drift or a late scheduled run must not
    // write that projection back over the terminal mission on disk.
    if (await deps.loadSessionOwner(currentMission.id)) return currentMission;
    let mission = currentMission;
    let automation = mission.automation;
    if (!automation) return mission;
    const storedAutomation = await deps.getAutomation(automation.id);
    if (storedAutomation && (
      storedAutomation.status !== automation.status ||
      (storedAutomation.rrule && storedAutomation.rrule !== automation.rrule)
    )) {
      automation = {
        ...automation,
        status: storedAutomation.status,
        rrule: storedAutomation.rrule ?? automation.rrule,
        ...(storedAutomation.status === "ACTIVE" ? { stopReason: undefined } : {}),
      };
      mission = { ...mission, automation, updatedAt: deps.now().toISOString() };
      await saveMission(mission);
    }

    // Oversized or otherwise unreadable workspace files must read as "no
    // checkpoint" instead of killing this mission's reconcile on every poll.
    const readCheckpointSafe = async (): Promise<
      { transcript: string; token: string; at: string } | null
    > => {
      try {
        return await deps.readAutomationCheckpoint(mission.id);
      } catch {
        return null;
      }
    };

    // A late or replayed automation run must never resurrect a terminal or
    // archived mission: persist run/checkpoint bookkeeping so the run stays
    // consumed, but never transition status, iterations, or finishedAt.
    if (
      TERMINAL_RESEARCH_MISSION_STATUSES.includes(mission.status)
    ) {
      const lateRun = await deps.latestAutomationRun(automation.id);
      const observedToken = (await readCheckpointSafe())?.token || undefined;
      const runChanged = lateRun !== null && (
        lateRun.id !== automation.lastRunId || lateRun.status !== automation.lastRunStatus
      );
      const tokenChanged = observedToken !== undefined && observedToken !== automation.checkpointToken;
      if (!runChanged && !tokenChanged) return mission;
      const updated: ResearchMission = {
        ...mission,
        updatedAt: deps.now().toISOString(),
        automation: {
          ...automation,
          ...(lateRun ? {
            lastRunId: lateRun.id,
            lastRunStatus: lateRun.status,
            lastRunAt: lateRun.finishedAt ?? lateRun.startedAt,
          } : {}),
          ...(observedToken ? { checkpointToken: observedToken } : {}),
        },
      };
      await saveMission(updated);
      return updated;
    }

    let run = await deps.latestAutomationRun(automation.id);
    let checkpointTranscript: string | null = null;
    let observedCheckpointToken: string | undefined;
    if (!run || run.id === automation.lastRunId) {
      const checkpoint = await readCheckpointSafe();
      if (!checkpoint?.token || checkpoint.token === automation.checkpointToken) return mission;
      checkpointTranscript = checkpoint.transcript;
      observedCheckpointToken = checkpoint.token;
      run = {
        id: `scheduled-${checkpoint.token}`,
        automationId: automation.id,
        automationName: `Research: ${mission.title}`,
        startedAt: checkpoint.at,
        finishedAt: checkpoint.at,
        status: "succeeded",
        summary: "Scheduled checkpoint detected",
      };
    }
    if (run.status === "queued" || run.status === "running") {
      const updated: ResearchMission = {
        ...mission,
        updatedAt: deps.now().toISOString(),
        automation: {
          ...automation,
          lastRunStatus: run.status,
          lastRunAt: run.startedAt,
        },
      };
      await saveMission(updated);
      return updated;
    }

    // Every settled run has performed its final checkpoint write by contract,
    // so observe the token now and persist it on EVERY consuming path below —
    // real and synthetic, success and pause alike. Otherwise the stale stored
    // token re-triggers the synthetic-run branch on every reconcile, causing
    // an infinite pause/save loop against the 2s desk poll.
    if (observedCheckpointToken === undefined) {
      observedCheckpointToken = (await readCheckpointSafe())?.token || undefined;
    }
    // An unreadable fingerprint reads as "unchanged" — the run is consumed
    // with a visible pause instead of throwing on every poll.
    const fingerprint = await deps.fingerprintMission(mission.id)
      .catch(() => automation.checkpointFingerprint);
    if (run.status === "failed") {
      return pauseLinkedAutomation(
        mission,
        run,
        run.summary || "Scheduled research iteration failed",
        { fingerprint, token: observedCheckpointToken },
      );
    }

    const transcript = checkpointTranscript === null
      ? await deps.readAutomationTranscript(run).catch(() => "")
      : checkpointTranscript;
    const control = parseResearchControl(transcript);
    if (control.reason === "Missing or malformed research control output") {
      return pauseLinkedAutomation(
        mission,
        run,
        "Automation run did not emit a valid control checkpoint",
        { fingerprint, token: observedCheckpointToken },
      );
    }
    if (fingerprint === automation.checkpointFingerprint) {
      return pauseLinkedAutomation(
        mission,
        run,
        "Automation run did not change the mission checkpoint",
        { fingerprint, token: observedCheckpointToken },
      );
    }

    const timestamp = deps.now().toISOString();
    const number = mission.iterations.length + 1;
    let status: ResearchMission["status"] = control.decision === "complete" ? "completed" : "checkpoint";
    let stopReason = control.decision === "complete" ? "Research marked complete" : null;
    let reconciled: ResearchMission = {
      ...mission,
      status,
      updatedAt: timestamp,
      // A non-completing transition out of any earlier settled state must not
      // keep a stale finishedAt.
      finishedAt: status === "completed" ? timestamp : undefined,
      lastError: undefined,
      iterations: [...mission.iterations, {
        number,
        status: control.decision === "complete" ? "completed" : "checkpoint",
        automationRunId: run.id,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? timestamp,
        decision: control.decision,
        decisionReason: control.reason,
        summary: control.reason,
      }],
      automation: {
        ...automation,
        checkpointFingerprint: fingerprint,
        ...(observedCheckpointToken ? { checkpointToken: observedCheckpointToken } : {}),
        lastRunId: run.id,
        lastRunStatus: run.status,
        lastRunAt: run.finishedAt ?? run.startedAt,
        stopReason: undefined,
      },
    };
    reconciled = await reconcileCompletedRun(
      reconciled,
      reconciled.iterations.length - 1,
      deps,
      transcript,
    );
    if (reconciled.lastError) {
      return pauseLinkedAutomation(
        reconciled,
        run,
        reconciled.lastError,
        { fingerprint, token: observedCheckpointToken },
      );
    }
    if (!stopReason) stopReason = stopBeforeNextIteration(reconciled, deps.now());
    if (
      !stopReason &&
      number % mission.bounds.checkpointEvery === 0
    ) {
      stopReason = "Checkpoint review required";
    }
    if (stopReason) {
      await deps.updateAutomation(automation.id, { status: "PAUSED" });
      status = stopReason === "Iteration limit reached" || control.decision === "complete"
        ? "completed"
        : stopReason === "Checkpoint review required"
          ? "checkpoint"
          : "paused";
      reconciled.status = status;
      reconciled.finishedAt = status === "completed" ? timestamp : undefined;
      reconciled.lastError = ["Research marked complete", "Checkpoint review required"].includes(stopReason)
        ? undefined
        : stopReason;
      reconciled.automation = {
        ...reconciled.automation!,
        status: "PAUSED",
        stopReason,
      };
    }
    await saveMission(reconciled);
    return reconciled;
  };

  reconcileFlowUnlocked = async (mission: ResearchMission): Promise<ResearchMission> => {
    const sessionOwner = await deps.loadSessionOwner(mission.id);
    // "planning" is included so a crash between the planning save and the
    // launch-result save (an iteration with no flowRunId yet) can be recovered
    // below instead of hanging forever with only Cancel available.
    if (!sessionOwner && !["queued", "planning", "running"].includes(mission.status)) return mission;
    if (sessionOwner && TERMINAL_RESEARCH_MISSION_STATUSES.includes(mission.status)) {
      const state = await deps.sessionState(
        sessionOwner.sessionId,
        sessionOwner.authority,
        sessionOwner.ownerKind,
      );
      if (state === "running" || state === "unknown") {
        const restored: ResearchMission = {
          ...mission,
          status: "running",
          finishedAt: undefined,
          updatedAt: deps.now().toISOString(),
          iterations: mission.iterations.map((iteration) => (
            iteration.number === sessionOwner.iteration
              ? { ...iteration, status: "running", finishedAt: undefined }
              : iteration
          )),
        };
        // A confirmed live owner proves the terminal fields were rewritten and
        // can be repaired durably. Unknown liveness may instead be the exact
        // crash window after Cancel saved terminal state but before owner
        // retirement; expose a cancellable projection without overwriting that
        // durable terminal truth until the owner is observable again.
        if (state === "running") await saveMission(restored);
        return restored;
      }
      await deps.clearSessionOwner(sessionOwner);
      return mission;
    }
    const iterationIndex = sessionOwner
      ? mission.iterations.findIndex((iteration) => iteration.number === sessionOwner.iteration)
      : mission.iterations.length - 1;
    const iteration = mission.iterations[iterationIndex];
    if (!iteration) {
      if (!sessionOwner) return mission;
      const state = await deps.sessionState(
        sessionOwner.sessionId,
        sessionOwner.authority,
        sessionOwner.ownerKind,
      );
      if (state === "running" || state === "unknown") return mission;
      const timestamp = deps.now().toISOString();
      const failed: ResearchMission = {
        ...mission,
        status: "failed",
        updatedAt: timestamp,
        lastError: "The private Research session owner no longer matches its mission iteration. The owned process is settled; Retry starts a fresh iteration.",
      };
      await saveMission(failed);
      await deps.clearSessionOwner(sessionOwner);
      return failed;
    }

    // Orphan recovery: a run that cannot land anymore (record missing from the
    // capped flow-run store, replaced by a travel replay under a new id, stuck
    // "queued" forever, or never launched at all) would otherwise pin the
    // mission in a non-terminal state with no action but Cancel. Past the
    // grace window, fail the iteration so Retry becomes available; within it,
    // change nothing — the run may still land.
    const recoveryBasisMs = Date.parse(iteration.startedAt ?? mission.updatedAt);
    const pastRecoveryGrace = Number.isFinite(recoveryBasisMs) &&
      deps.now().getTime() - recoveryBasisMs >= RESEARCH_RUN_RECOVERY_GRACE_MS;
    const failOrphan = async (
      lastError: string,
      summary: string,
      owner?: ResearchMissionSessionOwner,
    ): Promise<ResearchMission> => {
      const timestamp = deps.now().toISOString();
      const failed: ResearchMission = {
        ...mission,
        status: "failed",
        updatedAt: timestamp,
        lastError,
        iterations: mission.iterations.map((item, index) => index === iterationIndex ? {
          ...item,
          status: "failed",
          finishedAt: timestamp,
          summary,
        } : item),
      };
      await saveMission(failed);
      if (owner) await deps.clearSessionOwner(owner);
      return failed;
    };

    // Private ownership is authoritative for every direct Copilot run and
    // every privileged owner-local daemon run. Never consult the writable
    // mission session id, flow-run id, or current Cave daemon configuration
    // while this exact owner exists.
    if (sessionOwner) {
      const state = await deps.sessionState(
        sessionOwner.sessionId,
        sessionOwner.authority,
        sessionOwner.ownerKind,
      );
      if (state === "running" || state === "unknown") return mission;
      if (state === "finished") {
        const transcript = await deps.readSessionTranscript(
          sessionOwner.sessionId,
          sessionOwner.authority,
          sessionOwner.ownerKind,
        );
        const reconciled = await reconcileCompletedRun(
          mission,
          iterationIndex,
          deps,
          transcript,
          sessionOwner.sessionId,
        );
        await saveMission(reconciled);
        await deps.clearSessionOwner(sessionOwner);
        return reconciled;
      }
      // "gone" is the ABSENCE of evidence, not evidence of death, and for a
      // direct-copilot owner it is routinely wrong while the run is healthy.
      // sessionState proves liveness from the in-process ACTIVE_RUNS registry
      // and death from a persisted transcript, so a live run that has not
      // closed yet reports "gone" from any reader that does not share that
      // registry — and the transcript only appears at child close. Failing
      // immediately therefore killed working missions: measured repeatedly here
      // with the mission orphaned ~20s after launch while Copilot kept working,
      // its transcript landing afterwards.
      //
      // The recovery grace window above already models exactly this "cannot
      // prove it either way yet" state; honour it here instead of treating
      // silence as a terminal verdict. Past the window the orphan verdict still
      // stands, so a genuinely dead run is not pinned forever.
      if (state === "gone" && !pastRecoveryGrace) return mission;
      return failOrphan(
        "The owned Research session ended without reporting — Retry starts a fresh iteration.",
        "Owned session ended",
        sessionOwner,
      );
    }

    if (!iteration.flowRunId) {
      // A bookkeeping failure can leave the exact session id durably owned
      // without a Flow-run row. Never age that mission to failed while the
      // owner still reports a live or uncertain process. If it settled, consume
      // the same transcript/artifact boundary as an ordinary completed run.
      if (iteration.sessionId) {
        const state = await deps.sessionState(iteration.sessionId);
        if (state === "running" || state === "unknown") return mission;
        if (state === "finished") {
          const transcript = await deps.readSessionTranscript(
            iteration.sessionId,
          );
          const reconciled = await reconcileCompletedRun(mission, iterationIndex, deps, transcript);
          await saveMission(reconciled);
          return reconciled;
        }
        return failOrphan(
          "The unrecorded Research session ended without reporting — Retry starts a fresh iteration.",
          "Unrecorded session ended",
        );
      }
      if (pastRecoveryGrace) {
        return failOrphan(
          "Startup was interrupted before a research session was recorded — Retry starts a fresh iteration.",
          "Startup interrupted",
        );
      }
      return mission;
    }
    const run = await deps.loadFlowRun(iteration.flowRunId);
    if (!run) {
      if (pastRecoveryGrace) {
        return failOrphan(
          "The research run record is missing — recovered as failed. Retry starts a fresh iteration.",
          "Run record missing",
        );
      }
      return mission;
    }
    if (run.status === "running" || run.status === "queued") {
      // A run stuck "queued" past the grace window will never start under this
      // id — travel replay records the replayed run under a NEW flow run id,
      // so this record stays queued forever while the mission waits on it.
      if (run.status === "queued" && pastRecoveryGrace) {
        return failOrphan(
          "The queued research run never started — recovered as failed. Retry starts a fresh iteration.",
          "Queued run never started",
        );
      }
      // The flow-run record only says the run was STARTED — nothing flips it
      // when the underlying agent session ends, so probe the session itself
      // (cave-ibb7). A finished session reconciles from its transcript; a dead
      // one fails the mission with Retry enabled instead of hanging forever.
      if (run.status === "running" && iteration.sessionId) {
        const state = await deps.sessionState(iteration.sessionId);
        if (state === "finished") {
          const transcript = await deps.readSessionTranscript(
            iteration.sessionId,
          );
          const reconciled = await reconcileCompletedRun(mission, iterationIndex, deps, transcript);
          await saveMission(reconciled);
          return reconciled;
        }
        if (state === "gone" && !withinStartupGrace(iteration.startedAt, deps.now())) {
          const timestamp = deps.now().toISOString();
          const failed: ResearchMission = {
            ...mission,
            status: "failed",
            updatedAt: timestamp,
            lastError: "The research session ended without reporting — Retry starts a fresh iteration.",
            iterations: mission.iterations.map((item, index) => index === iterationIndex ? {
              ...item,
              status: "failed",
              finishedAt: timestamp,
              summary: "Session ended without control markers",
            } : item),
          };
          await saveMission(failed);
          return failed;
        }
      }
      const activeStatus: "running" | "queued" = run.status === "queued" ? "queued" : "running";
      const synced: ResearchMission = {
        ...mission,
        status: activeStatus,
        updatedAt: deps.now().toISOString(),
        iterations: mission.iterations.map((item, index) => index === iterationIndex ? {
          ...item,
          status: activeStatus,
          steps: run.steps.map((step) => ({ ...step })),
        } : item),
      };
      await saveMission(synced);
      return synced;
    }
    if (run.status === "failed") {
      const timestamp = deps.now().toISOString();
      const failed: ResearchMission = {
        ...mission,
        status: "failed",
        updatedAt: timestamp,
        lastError: run.summary || "Research Flow failed",
        iterations: mission.iterations.map((item, index) => index === iterationIndex ? {
          ...item,
          status: "failed",
          finishedAt: run.finishedAt ?? timestamp,
          summary: run.summary,
        } : item),
      };
      await saveMission(failed);
      return failed;
    }
    const reconciled = await reconcileCompletedRun(mission, iterationIndex, deps);
    await saveMission(reconciled);
    return reconciled;
  };

  return {
    async createAndStart(input: CreateResearchMissionInput): Promise<ResearchMission> {
      // Keep the runner safe when called outside the HTTP route (tests,
      // automation, future internal entry points). Validation is lossless:
      // overlong/NUL fields are refused, never silently sliced before launch.
      const validated = validateCreateResearchMissionInput(input);
      if (!validated.ok) throw new Error(validated.error);
      let mission = createMissionRecord(validated.value, deps.randomId(), deps.now());
      mission = await deps.createWorkspace(mission);
      await saveMission(mission);
      // The start sequence shares the per-mission action lock: without it, a
      // concurrent locked act('cancel') landing between the pre-launch save
      // and the launch-result save was silently overwritten back to running.
      return withResearchMissionActionLock(mission.id, async () => {
        let current = await deps.loadMission(mission.id) ?? mission;
        if (TERMINAL_RESEARCH_MISSION_STATUSES.includes(current.status)) return current;
        const target = await missionStartTarget(current);
        if (target.ok) await assertNoActiveSessionOwner(current.id);
        const result = target.ok
          ? await deps.startFlow(
            buildResearchMissionFlow(current, 1),
            missionStartOptions(current.id, 1, target.projectRoot, target.missionWorkspace, current),
          )
          : { ok: false, error: target.error };
        return persistLaunchResult(current, result);
      });
    },

    reconcile(mission: ResearchMission): Promise<ResearchMission> {
      return withResearchMissionActionLock(mission.id, async () => {
        const current = await deps.loadMission(mission.id) ?? mission;
        return reconcileFlowUnlocked(current);
      });
    },
    schedule(id: string, input: ResearchAutomationScheduleInput): Promise<ResearchMission> {
      return withResearchMissionActionLock(id, async () => {
        const mission = await deps.loadMission(id);
        if (!mission) throw new Error("research mission not found");
        await assertNoActiveSessionOwner(id);
        if (mission.mode !== "autoresearch") throw new Error("schedules require AutoResearch mode");
        // A terminal or archived mission must never gain a schedule — a later
        // automation run would otherwise try to revive it.
        if (TERMINAL_RESEARCH_MISSION_STATUSES.includes(mission.status)) {
          throw new Error(`cannot schedule a ${mission.status} research mission`);
        }
        if (mission.automation) throw new Error("research mission already has a schedule");
        const rrule = input.rrule.trim();
        if (!rrule.startsWith("RRULE:") || rrule.length > 500) {
          throw new Error("invalid automation schedule");
        }
        const stopReason = stopBeforeNextIteration(mission, deps.now());
        if (stopReason) throw new Error(stopReason);
        const workspace = deps.missionWorkspacePath(id);
        const [checkpointFingerprint, checkpoint] = await Promise.all([
          deps.fingerprintMission(id),
          deps.readAutomationCheckpoint(id),
        ]);
        const created = await deps.createAutomation({
          name: `Research: ${mission.title}`,
          rrule,
          prompt: automationPrompt(mission, workspace),
          cwds: [workspace],
          tags: ["research-mission", `research-mission:${mission.id}`],
          familiars: [mission.familiarId],
          model: input.model?.trim() ?? "",
          reasoningEffort: input.reasoningEffort?.trim() ?? "",
          executionEnvironment: input.executionEnvironment?.trim() ?? "",
          skillPath: input.skillPath?.trim() || null,
        });
        const updated: ResearchMission = {
          ...mission,
          automationId: created.id,
          automation: {
            id: created.id,
            rrule,
            status: "PAUSED",
            checkpointFingerprint,
            ...(checkpoint.token ? { checkpointToken: checkpoint.token } : {}),
          },
          updatedAt: deps.now().toISOString(),
        };
        await saveMission(updated);
        return updated;
      });
    },
    reconcileAutomation(mission: ResearchMission): Promise<ResearchMission> {
      return withResearchMissionActionLock(mission.id, async () => {
        // Preserve the flow reconciler's owner-aware projection. Reloading the
        // writable mission first would discard it and hide the exact Cancel
        // affordance; automation reconciliation is intentionally suspended
        // until the private owner is retired.
        if (await deps.loadSessionOwner(mission.id)) return mission;
        const current = await deps.loadMission(mission.id) ?? mission;
        return reconcileAutomationUnlocked(current);
      });
    },
    act,
  };
}

export function parseResearchSourcesFile(raw: string): ResearchSourceRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("sources.json is malformed");
  }
  if (!Array.isArray(parsed)) throw new Error("sources.json must contain an array");
  return parsed.map((item, index) => {
    const normalized = normalizeResearchSource(
      item as Parameters<typeof normalizeResearchSource>[0],
    );
    if (!normalized.ok) {
      throw new Error(`sources.json source ${index + 1}: ${normalized.reason}`);
    }
    return normalized.value;
  });
}

/**
 * True only when a failed kill response definitively says the addressed
 * session does not exist. A status-0 transport failure cannot distinguish a
 * stopped local daemon from an unreachable hub that still owns live work; 409
 * is likewise an ambiguous state conflict. Both must keep cancellation blocked.
 */
export const sessionAlreadyGone = daemonSessionAlreadyGone;

type ResearchSessionCancellationDependencies = {
  cancelDirect?: (
    sessionId: string,
  ) => Promise<"not-owned" | "terminated" | "already-finished">;
  callDaemonImpl?: (request: {
    method: "POST";
    path: string;
    timeoutMs: number;
  }) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;
  callDaemonTargetImpl?: (
    target: {
      mode: "local";
      label: "Local daemon";
      socketPath: string;
    },
    request: {
      method: "POST";
      path: string;
      timeoutMs: number;
    },
  ) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;
};

function targetForResearchSessionAuthority(authority: ResearchSessionAuthority): {
  mode: "local";
  label: "Local daemon";
  socketPath: string;
} {
  const parsed = parseResearchSessionAuthority(authority);
  if (!parsed) throw new Error("Research session authority is invalid");
  return {
    mode: "local",
    label: "Local daemon",
    socketPath: parsed.socketPath,
  };
}

/**
 * Stop the process owner before changing mission state. Cave-direct Copilot
 * sessions never exist in the daemon; a daemon 404 therefore cannot prove
 * their child tree stopped. Only fall back to the daemon when the direct-run
 * registry confirms it never owned this id.
 */
export async function cancelResearchSession(
  sessionId: string,
  dependencies: ResearchSessionCancellationDependencies = {},
  authority?: ResearchSessionAuthority,
  ownerKind?: ResearchMissionSessionOwner["ownerKind"],
): Promise<void> {
  const cancelDirect = dependencies.cancelDirect ?? (await import("./flow-copilot-session.ts")).cancelCopilotFlowRun;
  if (ownerKind !== "owner-local-daemon") {
    const directResult = await cancelDirect(sessionId);
    if (ownerKind === "direct-copilot") {
      // On a live/hot-reloaded server the process-global registry or settled
      // tombstone owns the id. After a full owner crash, absence is also safe:
      // the native supervisor's guardian/Job has already reaped the tree.
      return;
    }
    if (directResult !== "not-owned") return;
  }
  if (ownerKind === "owner-local-daemon" && !authority) {
    throw new Error("Research daemon session is missing its private launch authority");
  }

  const request = {
    method: "POST",
    path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/kill`,
    timeoutMs: 4_000,
  } as const;
  const response = authority
    ? await (
        dependencies.callDaemonTargetImpl
        ?? (await import("../coven-daemon.ts")).callDaemonTarget
      )(targetForResearchSessionAuthority(authority), request)
    : await (
        dependencies.callDaemonImpl
        ?? (await import("../coven-daemon.ts")).callDaemon
      )(request);
  if (!response.ok && !sessionAlreadyGone(response)) {
    const reason = response.status === 0
      ? "the daemon or hub was unreachable"
      : `the daemon or hub returned HTTP ${response.status}`;
    throw new Error(
      `Research session cancellation could not be confirmed because ${reason}. ` +
      "The mission remains running; retry Cancel after connectivity and session state are verified.",
    );
  }
}

type ResearchDaemonSessionStateDependencies = {
  callDaemonImpl?: (request: {
    path: string;
    timeoutMs: number;
  }) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;
  callDaemonTargetImpl?: (
    target: {
      mode: "local";
      label: "Local daemon";
      socketPath: string;
    },
    request: {
      path: string;
      timeoutMs: number;
    },
  ) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;
};

/** Query daemon liveness through the exact authority that launched this iteration. */
export async function researchDaemonSessionState(
  sessionId: string,
  authority?: ResearchSessionAuthority,
  dependencies: ResearchDaemonSessionStateDependencies = {},
): Promise<"running" | "finished" | "gone" | "unknown"> {
  const request = { path: "/api/v1/sessions", timeoutMs: 4_000 } as const;
  const response = authority
    ? await (
        dependencies.callDaemonTargetImpl
        ?? (await import("../coven-daemon.ts")).callDaemonTarget
      )(targetForResearchSessionAuthority(authority), request)
    : await (
        dependencies.callDaemonImpl
        ?? (await import("../coven-daemon.ts")).callDaemon
      )(request);
  if (!response.ok || !Array.isArray(response.data)) return "unknown";
  const sessions = response.data as Array<{ id?: unknown; status?: unknown; exit_code?: unknown }>;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return "gone";
  const status = typeof session.status === "string" ? session.status.toLowerCase() : "";
  const exitCode = typeof session.exit_code === "number" ? session.exit_code : null;
  if (status === "completed" && (exitCode ?? 0) === 0) return "finished";
  if (
    ["failed", "killed", "exited", "dead", "stopped", "cancelled"].includes(status)
    || (exitCode ?? 0) !== 0
  ) {
    return "gone";
  }
  return "running";
}

export function makeProductionResearchMissionRunner() {
  const deps: ResearchMissionRunnerDeps = {
    createWorkspace: createResearchMissionWorkspace,
    loadMission: loadResearchMission,
    saveMission: saveResearchMission,
    loadSessionOwner: loadResearchMissionSessionOwner,
    recordSessionOwner: recordResearchMissionSessionOwner,
    clearSessionOwner: clearResearchMissionSessionOwner,
    assertSessionOwnerPrivate: assertResearchSessionOwnerOutsideWriteRoots,
    startFlow: async (flow, options) => {
      const { startFlowSession } = await import("./flow-executor.ts");
      return startFlowSession(flow, {
        projectRoot: options.projectRoot,
        addDirs: options.addDirs,
        trustedLocalResearch: true,
        offlinePolicy: options.offlinePolicy,
        harness: options.harness,
        model: options.model,
        publishSessionOwner: options.publishSessionOwner,
      });
    },
    loadFlowRun: async (id) => {
      const { listFlowRuns } = await import("./flow-store.ts");
      return (await listFlowRuns()).find((run) => run.id === id) ?? null;
    },
    loadConversation: async (sessionId) => {
      const { loadConversation } = await import("../cave-conversations.ts");
      return loadConversation(sessionId);
    },
    readMissionFile: async (id, relativePath) => {
      try {
        return await readValidatedMissionFile(id, relativePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    readSources: async (id) => {
      const raw = await readValidatedMissionFile(id, "sources.json");
      return parseResearchSourcesFile(raw);
    },
    publishKnowledge: async (entry) => {
      const { writeKnowledgeEntry } = await import("./knowledge-vault.ts");
      return writeKnowledgeEntry(entry);
    },
    killSession: (sessionId, authority, ownerKind) => (
      cancelResearchSession(sessionId, {}, authority, ownerKind)
    ),
    sessionState: async (sessionId, authority, ownerKind) => {
      if (ownerKind === "owner-local-daemon") {
        if (!authority) return "unknown";
        return researchDaemonSessionState(sessionId, authority);
      }
      // Cave-direct copilot runs never exist on the daemon — the in-process
      // registry is their only live signal (flow-copilot-session, cave-lhc0).
      const { isCopilotFlowRunActive } = await import("./flow-copilot-session.ts");
      if (isCopilotFlowRunActive(sessionId)) return "running";
      // A persisted conversation with assistant output means the run finished
      // and its transcript is readable (direct runs write it at close).
      const { loadConversation } = await import("../cave-conversations.ts");
      const conversation = await loadConversation(sessionId);
      if (conversation?.turns?.some((turn) => turn.role === "assistant" && turn.text?.trim())) {
        return "finished";
      }
      if (ownerKind === "direct-copilot") return "gone";
      return researchDaemonSessionState(sessionId, authority);
    },
    readSessionTranscript: async (sessionId, authority, ownerKind) => {
      const { flowSessionTranscript } = await import("./flow-session-transcript.ts");
      return flowSessionTranscript(
        sessionId,
        ownerKind === "owner-local-daemon" && authority
          ? targetForResearchSessionAuthority(authority)
          : undefined,
      );
    },
    createAutomation: async (input) => {
      const { createCodexAutomation } = await import("../codex-automations.ts");
      return createCodexAutomation(input);
    },
    getAutomation: async (id) => {
      const { getCodexAutomation } = await import("../codex-automations.ts");
      return getCodexAutomation(id);
    },
    updateAutomation: async (id, patch) => {
      const { updateCodexAutomation } = await import("../codex-automations.ts");
      return updateCodexAutomation(id, patch);
    },
    latestAutomationRun: async (id) => {
      const { latestRun } = await import("../automation-runs.ts");
      return latestRun(id);
    },
    readAutomationTranscript: async (run) => {
      if (!run.logPath) return "";
      const [{ isAllowedAutomationLogPath, MAX_RUN_LOG_BYTES }, { readFile, stat }] = await Promise.all([
        import("./automation-log-paths.ts"),
        import("node:fs/promises"),
      ]);
      if (!(await isAllowedAutomationLogPath(run.logPath))) return "";
      const metadata = await stat(run.logPath);
      if (metadata.size > MAX_RUN_LOG_BYTES) return "";
      return readFile(run.logPath, "utf8");
    },
    readAutomationCheckpoint: async (id) => {
      try {
        const transcript = await readValidatedMissionFile(id, "automation-checkpoint.txt");
        const [{ createHash }, { stat }] = await Promise.all([
          import("node:crypto"),
          import("node:fs/promises"),
        ]);
        const metadata = await stat(
          `${researchMissionWorkspacePath(id)}/automation-checkpoint.txt`,
        );
        return {
          transcript,
          token: createHash("sha256").update(transcript).digest("hex").slice(0, 24),
          at: metadata.mtime.toISOString(),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { transcript: "", token: "", at: new Date(0).toISOString() };
        }
        throw error;
      }
    },
    fingerprintMission: async (id) => {
      const { createHash } = await import("node:crypto");
      const paths = [
        "research-state.yaml",
        "findings.md",
        "research-log.md",
        "sources.json",
        "artifacts/primary.md",
      ];
      const hash = createHash("sha256");
      for (const relativePath of paths) {
        hash.update(relativePath);
        try {
          hash.update(await readValidatedMissionFile(id, relativePath));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          hash.update("<missing>");
        }
      }
      return hash.digest("hex");
    },
    missionWorkspacePath: researchMissionWorkspacePath,
    resolveProjectRoot: async (root) => {
      const { normalizeProjectRoot } = await import("./session-security.ts");
      return normalizeProjectRoot(root);
    },
    ensureResearchAccess: async (familiarId) => {
      // Never let a landing-grant failure block the run itself: the mission
      // workspace stays writable through builtInProjectRoots either way, so
      // the worst outcome of a failure here is today's status quo (results
      // land but need a manual grant to be chat-reachable).
      try {
        const { ensureResearchLandingAccess } = await import("./research-landing.ts");
        await ensureResearchLandingAccess(familiarId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`research landing grant for ${familiarId} failed: ${message}`);
      }
    },
    checkFamiliarRootAccess: async (familiarId, projectRoot) => {
      const { assertProjectRootAccess, ProjectAccessDeniedError } = await import(
        "../project-permissions.ts"
      );
      try {
        await assertProjectRootAccess({ familiarId }, projectRoot, "session-launch", {
          allowUnregisteredRoot: true,
        });
        return null;
      } catch (error) {
        if (error instanceof ProjectAccessDeniedError) {
          return `Familiar "${familiarId}" does not have access to project root "${projectRoot}". Grant the project to this familiar in Permissions, or clear the mission's project root to run in its workspace.`;
        }
        throw error;
      }
    },
    now: () => new Date(),
    randomId: () => `research-${crypto.randomUUID()}`,
  };
  return makeResearchMissionRunner(deps);
}

/**
 * Last logged reconcile failure per mission — the desk list polls every 2s,
 * so a persistently broken mission must not flood the log with the same
 * message on every poll.
 */
const loggedReconcileFailures = new Map<string, string>();

/**
 * Reconcile every mission for the desk list, isolating failures per mission:
 * one poisoned mission (corrupt artifacts, oversized workspace file, deleted
 * directory, …) must degrade to its stored snapshot instead of failing the
 * whole list endpoint on every poll.
 */
export async function reconcileResearchMissionList(
  missions: ResearchMission[],
  runner: Pick<
    ReturnType<typeof makeResearchMissionRunner>,
    "reconcile" | "reconcileAutomation"
  >,
): Promise<ResearchMission[]> {
  // Prune dedupe entries for missions no longer in the list (deleted or
  // archived) so the module-level map cannot grow unbounded over a
  // long-lived process.
  const listedIds = new Set(missions.map((mission) => mission.id));
  for (const id of loggedReconcileFailures.keys()) {
    if (!listedIds.has(id)) loggedReconcileFailures.delete(id);
  }
  return Promise.all(missions.map(async (mission) => {
    let current = mission;
    try {
      current = await runner.reconcile(current);
      current = await runner.reconcileAutomation(current);
      loggedReconcileFailures.delete(mission.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (loggedReconcileFailures.get(mission.id) !== message) {
        loggedReconcileFailures.set(mission.id, message);
        console.error(`research mission ${mission.id} reconcile failed: ${message}`);
      }
    }
    return current;
  }));
}

export async function listAndReconcileResearchMissions(
  familiarId: string,
): Promise<ResearchMission[]> {
  const runner = makeProductionResearchMissionRunner();
  const missions = (await listResearchMissions()).filter(
    (mission) => mission.familiarId === familiarId && mission.status !== "archived",
  );
  return reconcileResearchMissionList(missions, runner);
}
