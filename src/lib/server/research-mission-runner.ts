import type { ConversationFile } from "../cave-conversations.ts";
import type { FlowDoc } from "../flow/flow-doc.ts";
import type { FlowRunRecord } from "../flows.ts";
import type { AutomationRunRecord } from "../automation-runs.ts";
import type { KnowledgeEntry } from "./knowledge-vault.ts";
import {
  normalizeResearchSource,
  parseResearchControl,
  researchKnowledgeEntry,
  validateResearchArtifactContent,
} from "../research-artifact-contract.ts";
import { buildResearchMissionFlow } from "../research-mission-flow.ts";
import {
  allowedResearchActions,
  type CreateResearchMissionInput,
  type ResearchArtifactKind,
  type ResearchArtifactRef,
  type ResearchMission,
  type ResearchMissionActionInput,
  type ResearchAutomationLink,
  type ResearchSourcePatch,
  type ResearchSourceRef,
} from "../research-missions.ts";
import {
  createResearchMissionWorkspace,
  listResearchMissions,
  loadResearchMission,
  readValidatedMissionFile,
  researchMissionWorkspacePath,
  saveResearchMission,
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
  startFlow(
    flow: FlowDoc,
    options: { projectRoot: string | null; addDirs?: string[] },
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
  sessionState(sessionId: string): Promise<"running" | "finished" | "gone" | "unknown">;
  /** Best transcript available for a flow session (conversation → JSONL → daemon events). */
  readSessionTranscript(sessionId: string): Promise<string>;
  readMissionFile(id: string, relativePath: string): Promise<string | null>;
  readSources(id: string): Promise<ResearchSourceRef[]>;
  publishKnowledge(entry: KnowledgeEntry): Promise<KnowledgeEntry>;
  killSession(sessionId: string): Promise<void>;
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

/**
 * Default primary-artifact kind for a mission mode — mirrors
 * artifactKindForMode in research-mission-lifecycle.ts, used only when a
 * stored mission carries no artifact refs at all.
 */
function defaultArtifactKindForMode(mode: ResearchMission["mode"]): ResearchArtifactKind {
  if (mode === "sweep") return "report";
  if (mode === "paper") return "paper";
  if (mode === "autoresearch") return "findings";
  return "brief";
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

async function reconcileCompletedRun(
  mission: ResearchMission,
  iterationIndex: number,
  deps: ResearchMissionRunnerDeps,
  transcriptOverride?: string,
): Promise<ResearchMission> {
  const iteration = mission.iterations[iterationIndex];
  // The conversation is loaded even when a transcript override is supplied:
  // the override only replaces the transcript TEXT — reported cost still
  // lives on the conversation turns and must keep feeding costUsd (and with
  // it stopWhenCostUnavailable / maxSpendUsd policy).
  const conversation = iteration.sessionId
    ? await deps.loadConversation(iteration.sessionId)
    : null;
  const control = parseResearchControl(transcriptOverride ?? conversationTranscript(conversation));
  const costUsd = conversationCost(conversation);
  const timestamp = deps.now().toISOString();
  const nextIteration = {
    ...iteration,
    status: control.decision === "complete" ? "completed" as const : "checkpoint" as const,
    finishedAt: timestamp,
    decision: control.decision,
    decisionReason: control.reason,
    summary: control.reason,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
  let markdown: string | null;
  let fileSources: ResearchSourceRef[];
  try {
    [markdown, fileSources] = await Promise.all([
      deps.readMissionFile(mission.id, "artifacts/primary.md"),
      deps.readSources(mission.id),
    ]);
  } catch (error) {
    return {
      ...mission,
      status: "checkpoint",
      updatedAt: timestamp,
      lastError: error instanceof Error ? error.message : "Research evidence could not be read",
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? {
        ...nextIteration,
        status: "checkpoint",
      } : item),
    };
  }
  const sources = mergeFileSources(mission.sources, fileSources);

  if (!markdown) {
    return {
      ...mission,
      status: "checkpoint",
      updatedAt: timestamp,
      lastError: "Research run completed without artifacts/primary.md",
      sources,
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? nextIteration : item),
    };
  }
  // A mission whose artifacts array is empty must reconcile instead of
  // throwing: validate against the mode's default kind and skip the
  // artifact-derived updates (there is no ref to update or publish).
  const primaryArtifact: ResearchArtifactRef | undefined = mission.artifacts[0];
  const content = validateResearchArtifactContent(
    primaryArtifact?.kind ?? defaultArtifactKindForMode(mission.mode),
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

  let artifacts = mission.artifacts;
  if (primaryArtifact) {
    let artifact: ResearchArtifactRef = {
      ...primaryArtifact,
      iteration: iteration.number,
      updatedAt: timestamp,
    };
    if (control.decision === "complete" && !artifact.knowledgeId) {
      const entry = await deps.publishKnowledge(researchKnowledgeEntry({
        mission,
        artifact,
        provenance: {
          missionId: mission.id,
          iteration: iteration.number,
          flowRunId: iteration.flowRunId,
          sessionId: iteration.sessionId,
          automationRunId: iteration.automationRunId,
          generatedAt: timestamp,
        },
        markdown: content.value,
      }));
      artifact = { ...artifact, knowledgeId: entry.id, state: "published" };
    }
    artifacts = [artifact, ...mission.artifacts.slice(1)];
  }

  return {
    ...mission,
    status: control.decision === "complete" ? "completed" : "checkpoint",
    updatedAt: timestamp,
    ...(control.decision === "complete" ? { finishedAt: timestamp } : {}),
    lastError: undefined,
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
   * Resolve the project root an iteration will run in before any session is
   * spawned. A configured-but-unallowed root fails fast with an actionable
   * message (the flow executor would only say "invalid project root"); the
   * default mission workspace always resolves.
   */
  const missionStartTarget = async (
    mission: ResearchMission,
  ): Promise<{ ok: true; projectRoot: string } | { ok: false; error: string }> => {
    if (mission.projectRoot) {
      const resolved = await deps.resolveProjectRoot(mission.projectRoot);
      if (resolved) return { ok: true, projectRoot: resolved };
      return {
        ok: false,
        error: `Project root "${mission.projectRoot}" is not an allowed project path. Retry in the mission workspace, or set a valid root (an existing Cave project or workspace folder).`,
      };
    }
    const workspace = deps.missionWorkspacePath(mission.id);
    const resolved = await deps.resolveProjectRoot(workspace);
    return { ok: true, projectRoot: resolved ?? workspace };
  };

  /**
   * Start options for one iteration: the resolved run root plus the mission
   * workspace as a harness-level trust grant. When a configured project root
   * makes the spawn cwd differ from the workspace, a non-interactive run
   * cannot prompt for permission — without the grant every workspace write
   * hard-fails and the iteration ends without artifacts/primary.md. A grant
   * equal to the spawn cwd is dropped by the flow spawn itself.
   */
  const missionStartOptions = (
    mission: ResearchMission,
    projectRoot: string,
  ): { projectRoot: string; addDirs: string[] } => ({
    projectRoot,
    addDirs: [deps.missionWorkspacePath(mission.id)],
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
    const trimmed = override?.trim() ?? "";
    if (!trimmed) return { ...mission, projectRoot: undefined };
    if (trimmed.length > 2_000 || trimmed.includes("\0")) {
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
    let next: ResearchMission = {
      ...mission,
      status: "planning",
      updatedAt: timestamp,
      finishedAt: undefined,
      lastError: undefined,
      iterations: [...mission.iterations, { number, status: "queued" }],
      artifacts: workingArtifact ? [workingArtifact, ...mission.artifacts] : mission.artifacts,
    };
    await saveMission(next);
    const target = await missionStartTarget(next);
    const result = target.ok
      ? await deps.startFlow(buildResearchMissionFlow(next, number), missionStartOptions(next, target.projectRoot))
      : { ok: false, error: target.error };
    next = applyStartResult(next, result, deps.now());
    await saveMission(next);
    return next;
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
    await saveMission(retried);
    const target = await missionStartTarget(retried);
    const result = target.ok
      ? await deps.startFlow(
        buildResearchMissionFlow(retried, current.number),
        missionStartOptions(retried, target.projectRoot),
      )
      : { ok: false, error: target.error };
    retried = applyStartResult(retried, result, deps.now());
    await saveMission(retried);
    return retried;
  };

  const act = (id: string, input: ResearchMissionActionInput): Promise<ResearchMission> => (
    withResearchMissionActionLock(id, async () => {
      let mission = await deps.loadMission(id);
      if (!mission) throw new Error("research mission not found");
      mission = await reconcileFlowUnlocked(mission);
      const timestamp = deps.now().toISOString();

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
        return saveUpdated({ ...mission, artifacts });
      }

      if (!allowedResearchActions(mission).includes(input.action)) return mission;
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
        const direction = input.direction?.trim().slice(0, 2_000) ?? "";
        if (!direction) throw new Error("refined direction required");
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
        if (current?.sessionId && currentActive) {
          await deps.killSession(current.sessionId);
        }
        const cancelledMission = await pauseAutomation(mission, "Mission cancelled");
        return saveUpdated({
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
      }
      if (input.action === "finish") {
        mission = await pauseAutomation(mission, "Mission finished");
        return saveUpdated({
          ...mission,
          status: "completed",
          finishedAt: timestamp,
          lastError: undefined,
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
    // "planning" is included so a crash between the planning save and the
    // launch-result save (an iteration with no flowRunId yet) can be recovered
    // below instead of hanging forever with only Cancel available.
    if (!["queued", "planning", "running"].includes(mission.status)) return mission;
    const iterationIndex = mission.iterations.length - 1;
    const iteration = mission.iterations[iterationIndex];
    if (!iteration) return mission;

    // Orphan recovery: a run that cannot land anymore (record missing from the
    // capped flow-run store, replaced by a travel replay under a new id, stuck
    // "queued" forever, or never launched at all) would otherwise pin the
    // mission in a non-terminal state with no action but Cancel. Past the
    // grace window, fail the iteration so Retry becomes available; within it,
    // change nothing — the run may still land.
    const recoveryBasisMs = Date.parse(iteration.startedAt ?? mission.updatedAt);
    const pastRecoveryGrace = Number.isFinite(recoveryBasisMs) &&
      deps.now().getTime() - recoveryBasisMs >= RESEARCH_RUN_RECOVERY_GRACE_MS;
    const failOrphan = async (lastError: string, summary: string): Promise<ResearchMission> => {
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
      return failed;
    };

    if (!iteration.flowRunId) {
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
          const transcript = await deps.readSessionTranscript(iteration.sessionId);
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
      let mission = createMissionRecord(input, deps.randomId(), deps.now());
      mission = await deps.createWorkspace(mission);
      await saveMission(mission);
      // The start sequence shares the per-mission action lock: without it, a
      // concurrent locked act('cancel') landing between the pre-launch save
      // and the launch-result save was silently overwritten back to running.
      return withResearchMissionActionLock(mission.id, async () => {
        let current = await deps.loadMission(mission.id) ?? mission;
        if (TERMINAL_RESEARCH_MISSION_STATUSES.includes(current.status)) return current;
        const target = await missionStartTarget(current);
        const result = target.ok
          ? await deps.startFlow(buildResearchMissionFlow(current, 1), missionStartOptions(current, target.projectRoot))
          : { ok: false, error: target.error };
        current = applyStartResult(current, result, deps.now());
        await saveMission(current);
        return current;
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
 * True when a failed kill response means the session is already not running.
 * Verified against the live daemon: killing an already-exited session returns
 * 409; a session the daemon never knew (pruned, or a Cave-direct session that
 * never existed daemon-side) is 404/410; status 0 means there is no daemon to
 * be running it at all. Cancel's goal state is "nothing running", which is
 * already true in each of those cases. Auth/rate-limit rejections (401/403/
 * 429) and daemon errors (5xx) stay blocking — the daemon or hub is alive and
 * the session may genuinely still be running (cave-malz).
 */
export function sessionAlreadyGone(response: { ok: boolean; status: number }): boolean {
  if (response.ok) return false;
  return response.status === 0
    || response.status === 404
    || response.status === 409
    || response.status === 410;
}

export function makeProductionResearchMissionRunner() {
  const deps: ResearchMissionRunnerDeps = {
    createWorkspace: createResearchMissionWorkspace,
    loadMission: loadResearchMission,
    saveMission: saveResearchMission,
    startFlow: async (flow, options) => {
      const { startFlowSession } = await import("./flow-executor.ts");
      return startFlowSession(flow, {
        projectRoot: options.projectRoot,
        addDirs: options.addDirs,
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
    killSession: async (sessionId) => {
      const { callDaemon } = await import("../coven-daemon.ts");
      const response = await callDaemon({
        method: "POST",
        path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/kill`,
        timeoutMs: 4_000,
      });
      if (!response.ok && !sessionAlreadyGone(response)) {
        throw new Error(response.error ?? "Research session could not be cancelled");
      }
    },
    sessionState: async (sessionId) => {
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
      const { callDaemon } = await import("../coven-daemon.ts");
      const res = await callDaemon<Array<{ id: string; status?: string; exit_code?: number | null }>>({
        path: "/api/v1/sessions",
        timeoutMs: 4_000,
      });
      if (!res.ok || !Array.isArray(res.data)) return "unknown";
      const session = res.data.find((item) => item.id === sessionId);
      if (!session) return "gone";
      const status = (session.status ?? "").toLowerCase();
      if (status === "completed" && (session.exit_code ?? 0) === 0) return "finished";
      if (
        ["failed", "killed", "exited", "dead", "stopped", "cancelled"].includes(status) ||
        (session.exit_code ?? 0) !== 0
      ) {
        return "gone";
      }
      return "running";
    },
    readSessionTranscript: async (sessionId) => {
      const { flowSessionTranscript } = await import("./flow-session-transcript.ts");
      return flowSessionTranscript(sessionId);
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
