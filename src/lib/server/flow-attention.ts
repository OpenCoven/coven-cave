import { createHash, randomUUID } from "node:crypto";
import { withInboxLock, type InboxItem } from "../cave-inbox.ts";
import { markFlowSessionCompleted } from "../cave-config.ts";
import { extractChatAttentionMarker, type ChatAttentionReason } from "../chat-attention-marker.ts";
import { flowSessionReferenceFor } from "../flow-session.ts";
import type { FlowRunRecord } from "../flows.ts";
import { broadcastCreated, broadcastUpdated } from "../inbox-scheduler.ts";
import type { ResearchMission } from "../research-missions.ts";
import { listFlowRuns, loadFlowSessionState, updateFlowRun } from "./flow-store.ts";

const NEXT_STEPS: Record<ChatAttentionReason, string> = {
  approval: "Review the approval request and approve or decline it before continuing.",
  credentials: "Review the execution and provide the required credentials before retrying.",
  decision: "Review the execution and choose how to proceed.",
  input: "Review the execution and provide the requested input.",
};

async function emitOnce(input: {
  key: string;
  revision: string;
  request?: InboxItem["autoRequest"];
  title: string;
  body: string;
  destination: string;
  familiarId?: string;
}): Promise<InboxItem | null> {
  // Decision and insert share the inbox's mutation lock: concurrent completion
  // callbacks cannot each create their own notification for the same owner.
  const result = await withInboxLock(async ({ load, save }) => {
    const file = await load();
    const existing = file.items.find((item) => item.auto === input.key);
    if (existing?.autoRevision === input.revision || existing?.autoRequest?.revision === input.revision) return null;
    const now = new Date().toISOString();
    const fields = {
      title: input.title,
      body: input.body,
      updatedAt: now,
      familiarId: input.familiarId ?? null,
      link: { kind: "url" as const, ref: input.destination },
      autoRevision: input.revision,
      ...(input.request ? { autoRequest: input.request } : {}),
    };
    if (existing) {
      const rearm = existing.status === "done" || existing.status === "dismissed";
      Object.assign(existing, fields, rearm ? {
        status: "fired", firedAt: now, readAt: null, snoozeUntil: null, fireAt: null,
      } : {});
      await save(file);
      return { item: existing, notify: rearm };
    }
    const created: InboxItem = {
      ...fields,
      id: randomUUID(),
      kind: "agent",
      status: "fired",
      createdAt: now,
      firedAt: now,
      recurrence: { type: "none" },
      source: "system",
      sessionId: null,
      auto: input.key,
      readAt: null,
    };
    file.items.push(created);
    await save(file);
    return { item: created, notify: true };
  });
  if (!result) return null;
  if (result.notify) broadcastCreated(result.item);
  else broadcastUpdated(result.item);
  return result.notify ? result.item : null;
}

async function resolveAttention(key: string, mission?: ResearchMission): Promise<null> {
  const item = await withInboxLock(async ({ load, save }) => {
    const file = await load();
    const existing = file.items.find((item) => item.auto === key);
    if (!existing || existing.autoRevision?.startsWith("resolved:")) return null;
    if (existing.autoRequest && mission && !["cancelled", "archived"].includes(mission.status)) {
      const request = existing.autoRequest;
      const iteration = request.iteration ??
        mission?.iterations.find((item) => item.flowRunId === request.runId)?.number;
      const latest = mission?.iterations.at(-1)?.number;
      if (iteration === undefined || latest === undefined || latest <= iteration) return null;
    }
    existing.status = "done";
    existing.autoRevision = `resolved:${existing.autoRevision ?? ""}`;
    existing.updatedAt = new Date().toISOString();
    await save(file);
    return existing;
  });
  if (item) broadcastUpdated(item);
  return null;
}

type FlowSessionCompletion = {
  sessionId: string;
  isError?: boolean;
  text?: string;
  familiarId?: string;
};

export async function finalizeFlowSession(input: FlowSessionCompletion & {
  finishedAt: string;
  cancelled?: boolean;
}): Promise<InboxItem | null> {
  let owned = false;
  let historySettled = false;
  try {
    const state = await loadFlowSessionState(false);
    const owner = flowSessionReferenceFor(state.sessionFlow, input.sessionId);
    if (owner) {
      owned = true;
      await updateFlowRun(owner.runId, {
        status: input.isError || input.cancelled ? "failed" : "succeeded",
        finishedAt: input.finishedAt,
      });
      historySettled = true;
    }
  } catch (error) {
    // History persistence must not strand the live process handle or swallow
    // an actionable notification when the transcript has already settled.
    console.warn("[flow-attention] Could not settle Flow run history:", error);
  }
  try {
    const item = input.cancelled ? null : await emitFlowSessionAttention(input, { propagateErrors: true });
    if (owned && historySettled) await markFlowSessionCompleted(input.sessionId);
    return item;
  } catch (error) {
    console.warn("[flow-attention] Could not persist completion acknowledgement; outcome remains pending:", error);
    return null;
  }
}

export async function emitFlowSessionAttention(
  input: FlowSessionCompletion,
  options: { propagateErrors?: boolean } = {},
): Promise<InboxItem | null> {
  try {
    if (!input.sessionId) return null;
    const state = await loadFlowSessionState(false);
    const owner = flowSessionReferenceFor(state.sessionFlow, input.sessionId);
    if (!owner) return null;
    const run = (await listFlowRuns()).find((candidate) => candidate.id === owner.runId);
    return await emitFlowRunAttention({
      id: owner.runId,
      flowId: owner.flowId,
      flowName: run?.flowName,
      missionId: owner.missionId,
      iteration: owner.iteration,
      sessionId: input.sessionId,
      status: input.isError ? "failed" : "succeeded",
      text: input.text,
      familiarId: input.familiarId ?? state.sessionFamiliar[input.sessionId],
    }, options);
  } catch (error) {
    if (options.propagateErrors) throw error;
    console.warn("[flow-attention] Could not notify the execution owner:", error);
    return null;
  }
}

export async function emitFlowRunAttention(
  run: Pick<FlowRunRecord, "id" | "flowId" | "flowName" | "status" | "missionId" | "sessionId" | "iteration"> & {
    text?: string;
    familiarId?: string;
  },
  options: { propagateErrors?: boolean } = {},
): Promise<InboxItem | null> {
  try {
    const request = extractChatAttentionMarker(run.text ?? "").request;
    if (run.status !== "failed" && !request) {
      return run.missionId ? null : await resolveAttention(`flow-attention:run:${run.id}`);
    }
    // An iteration transport failure is not yet the mission's outcome. The
    // mission persistence boundary decides whether retry/review is necessary.
    if (run.missionId && !request) return null;
    const destination = new URLSearchParams(run.missionId
      ? { mode: "surface:researcher-desk", researchMission: run.missionId }
      : { mode: "chat", flowRun: run.id });
    if (!run.missionId && run.sessionId) destination.set("flowSession", run.sessionId);
    if (run.familiarId) destination.set("flowFamiliar", run.familiarId);
    const revision = `${run.id}:${run.status}:${request?.reason ?? "failure"}`;
    return await emitOnce({
      key: run.missionId
        ? `flow-attention:mission:${run.missionId}`
        : `flow-attention:run:${run.id}`,
      revision,
      request: request ? { runId: run.id, iteration: run.iteration, revision } : undefined,
      title: run.missionId
        ? `Research needs attention: ${run.missionId}`
        : `Flow needs attention: ${run.flowName || run.flowId}`,
      body: request
        ? NEXT_STEPS[request.reason]
        : "Review the failed Flow execution, resolve the error, and retry.",
      destination: `/?${destination}`,
      familiarId: run.familiarId,
    });
  } catch (error) {
    if (options.propagateErrors) throw error;
    console.warn("[flow-attention] Could not notify the Flow run owner:", error);
    return null;
  }
}

export async function emitResearchMissionAttention(mission: ResearchMission): Promise<InboxItem | null> {
  try {
    const key = `flow-attention:mission:${mission.id}`;
    if (["queued", "planning", "running", "cancelled", "archived"].includes(mission.status)) {
      return await resolveAttention(key, mission);
    }
    const needsRepair = Boolean(mission.lastError) && mission.lastError !== "Iteration limit reached";
    const needsReview = mission.status === "checkpoint" && mission.automation?.status !== "ACTIVE";
    if (mission.status !== "failed" && !needsRepair && !needsReview) return await resolveAttention(key, mission);
    const revision = createHash("sha256").update(JSON.stringify([
      mission.status, mission.lastError, mission.iterations.at(-1)?.flowRunId,
      mission.iterations.length, mission.familiarId,
    ])).digest("hex");
    return await emitOnce({
      key,
      revision,
      title: `Research needs attention: ${mission.title}`,
      body: mission.status === "failed"
        ? "Review the failed mission in Research, resolve the error, and retry."
        : needsRepair
          ? "Review the mission's error or stopping condition in Research before continuing."
          : "Review the mission checkpoint in Research, then continue, refine, or finish.",
      destination: `/?${new URLSearchParams({
        mode: "surface:researcher-desk",
        researchMission: mission.id,
        flowFamiliar: mission.familiarId,
      })}`,
      familiarId: mission.familiarId,
    });
  } catch (error) {
    console.warn("[flow-attention] Could not notify the Research mission owner:", error);
    return null;
  }
}
