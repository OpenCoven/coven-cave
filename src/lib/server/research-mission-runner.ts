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

export type ResearchFlowStartResult = {
  ok: boolean;
  executor?: "session" | "travel-queue";
  sessionId?: string;
  run?: FlowRunRecord;
  queued?: boolean;
  unavailable?: boolean;
  error?: string;
};

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
    options: { projectRoot: string | null },
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

function artifactKindForMode(mode: ResearchMission["mode"]): ResearchArtifactKind {
  if (mode === "sweep") return "report";
  if (mode === "paper") return "paper";
  if (mode === "autoresearch") return "findings";
  return "brief";
}

function missionTitle(input: CreateResearchMissionInput): string {
  const explicit = input.title?.trim();
  if (explicit) return explicit.slice(0, 160);
  const intent = input.intent.trim().replace(/\s+/g, " ");
  return intent.length <= 80 ? intent : `${intent.slice(0, 77)}…`;
}

function createMissionRecord(
  input: CreateResearchMissionInput,
  id: string,
  now: Date,
): ResearchMission {
  const timestamp = now.toISOString();
  const kind = artifactKindForMode(input.mode);
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
    artifacts: [{
      key: "primary",
      kind,
      title: missionTitle(input),
      relativePath: "artifacts/primary.md",
      iteration: 1,
      state: "working",
      updatedAt: timestamp,
    }],
    sources: [],
  };
}

function applyStartResult(
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

/** A just-started session may not be observable yet — don't declare a
 *  running iteration dead within its first minute (registration races). */
const SESSION_STARTUP_GRACE_MS = 60_000;

export function withinStartupGrace(startedAt: string | undefined, now: Date): boolean {
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  // Symmetric window: a slightly-future startedAt (clock skew) still gets
  // grace, but a far-future one (bad data) can't suppress dead-session
  // detection indefinitely.
  return Math.abs(now.getTime() - started) < SESSION_STARTUP_GRACE_MS;
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

declare global {
  var __caveResearchMissionActionLocks: Map<string, Promise<void>> | undefined;
}

function withResearchMissionActionLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  globalThis.__caveResearchMissionActionLocks ??= new Map();
  const locks = globalThis.__caveResearchMissionActionLocks;
  const previous = locks.get(id) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(() => undefined, () => undefined);
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return result;
}

function stopBeforeNextIteration(mission: ResearchMission, now: Date): string | null {
  if (mission.iterations.length >= mission.bounds.maxIterations) return "Iteration limit reached";
  const startedAt = mission.startedAt ? Date.parse(mission.startedAt) : Number.NaN;
  if (
    Number.isFinite(startedAt) &&
    now.getTime() - startedAt >= mission.bounds.wallClockMinutes * 60_000
  ) {
    return "Wall-clock limit reached";
  }
  const knownCosts = mission.iterations
    .map((iteration) => iteration.costUsd)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (
    mission.bounds.stopWhenCostUnavailable &&
    mission.iterations.some((iteration) => iteration.finishedAt && iteration.costUsd === undefined)
  ) {
    return "Cost unavailable; review before another iteration";
  }
  if (
    mission.bounds.maxSpendUsd !== undefined &&
    knownCosts.reduce((sum, value) => sum + value, 0) >= mission.bounds.maxSpendUsd
  ) {
    return "Reported spend limit reached";
  }
  return null;
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

function patchResearchSource(
  mission: ResearchMission,
  sourceId: string,
  patch: ResearchSourcePatch,
): ResearchMission {
  const allowedStatuses: ResearchSourceRef["status"][] = [
    "candidate", "used", "conflicting", "rejected",
  ];
  if (patch.status && !allowedStatuses.includes(patch.status)) {
    throw new Error("invalid source status");
  }
  if (
    patch.confidence !== undefined &&
    (!Number.isFinite(patch.confidence) || patch.confidence < 0 || patch.confidence > 1)
  ) {
    throw new Error("invalid source confidence");
  }
  let found = false;
  const sources = mission.sources.map((source) => {
    if (source.id !== sourceId) return source;
    found = true;
    return {
      ...source,
      ...patch,
      ...(patch.title ? { title: patch.title.trim().slice(0, 300) } : {}),
      ...(patch.note ? { note: patch.note.trim().slice(0, 2_000) } : {}),
      ...(patch.claim ? { claim: patch.claim.trim().slice(0, 2_000) } : {}),
    };
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
  let sources: ResearchSourceRef[];
  try {
    [markdown, sources] = await Promise.all([
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
  const content = validateResearchArtifactContent(mission.artifacts[0].kind, markdown);
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

  let artifact: ResearchArtifactRef = {
    ...mission.artifacts[0],
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

  return {
    ...mission,
    status: control.decision === "complete" ? "completed" : "checkpoint",
    updatedAt: timestamp,
    ...(control.decision === "complete" ? { finishedAt: timestamp } : {}),
    lastError: undefined,
    sources,
    artifacts: [artifact, ...mission.artifacts.slice(1)],
    iterations: mission.iterations.map((item, index) => index === iterationIndex ? nextIteration : item),
  };
}

export function makeResearchMissionRunner(deps: ResearchMissionRunnerDeps) {
  let reconcileFlowUnlocked: (mission: ResearchMission) => Promise<ResearchMission>;
  const saveUpdated = async (mission: ResearchMission): Promise<ResearchMission> => {
    const updated = { ...mission, updatedAt: deps.now().toISOString() };
    await deps.saveMission(updated);
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
    await deps.saveMission(next);
    const target = await missionStartTarget(next);
    const result = target.ok
      ? await deps.startFlow(buildResearchMissionFlow(next, number), { projectRoot: target.projectRoot })
      : { ok: false, error: target.error };
    next = applyStartResult(next, result, deps.now());
    await deps.saveMission(next);
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
    await deps.saveMission(retried);
    const target = await missionStartTarget(retried);
    const result = target.ok
      ? await deps.startFlow(buildResearchMissionFlow(retried, current.number), {
        projectRoot: target.projectRoot,
      })
      : { ok: false, error: target.error };
    retried = applyStartResult(retried, result, deps.now());
    await deps.saveMission(retried);
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
        if (current?.sessionId && current.status === "running") {
          await deps.killSession(current.sessionId);
        }
        const cancelledMission = await pauseAutomation(mission, "Mission cancelled");
        return saveUpdated({
          ...cancelledMission,
          status: "cancelled",
          finishedAt: timestamp,
          iterations: cancelledMission.iterations.map((iteration, index) => (
            index === cancelledMission.iterations.length - 1
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
      if (input.action === "pause") {
        mission = await pauseAutomation(mission, "Mission paused");
        return saveUpdated({ ...mission, status: "paused" });
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
    await deps.saveMission(updated);
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
      await deps.saveMission(mission);
    }
    let run = await deps.latestAutomationRun(automation.id);
    let checkpointTranscript: string | null = null;
    let checkpointToken: string | undefined;
    if (!run || run.id === automation.lastRunId) {
      const checkpoint = await deps.readAutomationCheckpoint(mission.id);
      if (!checkpoint.token || checkpoint.token === automation.checkpointToken) return mission;
      checkpointTranscript = checkpoint.transcript;
      checkpointToken = checkpoint.token;
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
      await deps.saveMission(updated);
      return updated;
    }
    if (run.status === "failed") {
      return pauseLinkedAutomation(
        mission,
        run,
        run.summary || "Scheduled research iteration failed",
      );
    }

    const [transcript, fingerprint] = await Promise.all([
      checkpointTranscript === null ? deps.readAutomationTranscript(run) : Promise.resolve(checkpointTranscript),
      deps.fingerprintMission(mission.id),
    ]);
    const control = parseResearchControl(transcript);
    if (control.reason === "Missing or malformed research control output") {
      return pauseLinkedAutomation(
        mission,
        run,
        "Automation run did not emit a valid control checkpoint",
        { fingerprint, token: checkpointToken },
      );
    }
    if (fingerprint === automation.checkpointFingerprint) {
      return pauseLinkedAutomation(mission, run, "Automation run did not change the mission checkpoint");
    }

    const timestamp = deps.now().toISOString();
    const number = mission.iterations.length + 1;
    let status: ResearchMission["status"] = control.decision === "complete" ? "completed" : "checkpoint";
    let stopReason = control.decision === "complete" ? "Research marked complete" : null;
    let reconciled: ResearchMission = {
      ...mission,
      status,
      updatedAt: timestamp,
      ...(status === "completed" ? { finishedAt: timestamp } : {}),
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
        ...(checkpointToken ? { checkpointToken } : {}),
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
        { fingerprint, token: checkpointToken },
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
    await deps.saveMission(reconciled);
    return reconciled;
  };

  reconcileFlowUnlocked = async (mission: ResearchMission): Promise<ResearchMission> => {
    if (!["queued", "running"].includes(mission.status)) return mission;
    const iterationIndex = mission.iterations.length - 1;
    const iteration = mission.iterations[iterationIndex];
    if (!iteration?.flowRunId) return mission;
    const run = await deps.loadFlowRun(iteration.flowRunId);
    if (!run) return mission;
    if (run.status === "running" || run.status === "queued") {
      // The flow-run record only says the run was STARTED — nothing flips it
      // when the underlying agent session ends, so probe the session itself
      // (cave-ibb7). A finished session reconciles from its transcript; a dead
      // one fails the mission with Retry enabled instead of hanging forever.
      if (run.status === "running" && iteration.sessionId) {
        const state = await deps.sessionState(iteration.sessionId);
        if (state === "finished") {
          const transcript = await deps.readSessionTranscript(iteration.sessionId);
          const reconciled = await reconcileCompletedRun(mission, iterationIndex, deps, transcript);
          await deps.saveMission(reconciled);
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
          await deps.saveMission(failed);
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
      await deps.saveMission(synced);
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
      await deps.saveMission(failed);
      return failed;
    }
    const reconciled = await reconcileCompletedRun(mission, iterationIndex, deps);
    await deps.saveMission(reconciled);
    return reconciled;
  };

  return {
    async createAndStart(input: CreateResearchMissionInput): Promise<ResearchMission> {
      let mission = createMissionRecord(input, deps.randomId(), deps.now());
      mission = await deps.createWorkspace(mission);
      await deps.saveMission(mission);
      const target = await missionStartTarget(mission);
      const result = target.ok
        ? await deps.startFlow(buildResearchMissionFlow(mission, 1), { projectRoot: target.projectRoot })
        : { ok: false, error: target.error };
      mission = applyStartResult(mission, result, deps.now());
      await deps.saveMission(mission);
      return mission;
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
        await deps.saveMission(updated);
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
      return startFlowSession(flow, { projectRoot: options.projectRoot });
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

export async function listAndReconcileResearchMissions(
  familiarId: string,
): Promise<ResearchMission[]> {
  const runner = makeProductionResearchMissionRunner();
  const missions = (await listResearchMissions()).filter(
    (mission) => mission.familiarId === familiarId && mission.status !== "archived",
  );
  return Promise.all(missions.map(async (mission) => {
    const flowReconciled = await runner.reconcile(mission);
    return runner.reconcileAutomation(flowReconciled);
  }));
}
