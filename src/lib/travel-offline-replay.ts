import {
  bindingFor,
  completeOfflineTravelItem,
  failOfflineTravelItem,
  markOfflineTravelItemSyncing,
  offlineTravelItemsNeedingSync,
  recordSessionFamiliar,
  setSessionTitle,
  updateOfflineTravelItemPayload,
  type CaveConfig,
  type CaveTravelQueueItem,
} from "@/lib/cave-config";
import { chatTitleFromPrompt, defaultChatTitleForSession } from "@/lib/cave-chat-titles";
import { buildPromptWithAttachments, type ChatAttachment } from "@/lib/chat-attachments";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import type { CodexAutomation } from "@/lib/codex-automations-types";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { isSshRuntime } from "@/lib/familiar-runtime";
import { cleanModelId } from "@/lib/chat-model-state";
import { ACTIVE_SESSION_STATUSES } from "@/lib/chat-auto-archive";
import { isModelAllowedByRuntime } from "@/lib/runtime-models";
import {
  latestValidatedReplayConversationId,
  loadConversation,
  normalizeDaemonConversationId,
  persistQueuedOfflineConversation,
  persistResolvedReplayConversationId,
  validatedConversationHarnessSessionId,
} from "@/lib/cave-conversations";
import { flowExecutionOrder, flowPartialExecutionOrder, compileFlowPrompt } from "@/lib/flow/flow-compile";
import type { FlowExecutionMode } from "@/lib/flow/flow-compile";
import type { FlowDoc } from "@/lib/flow/flow-doc";
import { catalogNode } from "@/lib/flow/flow-catalog";
import { extractFlowCustomData } from "@/lib/flow/flow-execution-data";
import { flowRunRedactsData } from "@/lib/flow/flow-doc";
import type { FlowRunStepStatus } from "@/lib/flows";
import { startAutomationRun } from "@/lib/server/automation-runner";
import { recordFlowRun, updateFlowRun } from "@/lib/server/flow-store";
import { assertProjectRootAccess } from "@/lib/project-permissions";
import { isAllowedHarness, normalizeProjectRoot } from "@/lib/server/session-security";
import { hermesProfileDaemonLaunchBlockReason } from "@/lib/hermes-profiles";
import { buildWorkflowRunPrompt } from "@/lib/workflow-run-prompt";
import { recordRun } from "@/lib/workflow-runs";
import { loadLocalWorkflowList } from "@/lib/workflow-source";
import type { WorkflowSummary } from "@/lib/workflows";

export type TravelOfflineReplayResult = {
  attempted: number;
  synced: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
};

type DaemonSessionResponse = {
  id?: string;
  status?: string;
  conversationId?: string | null;
  conversation_id?: string | null;
  retryAfter?: string | number | null;
  retry_after?: string | number | null;
  updated_at?: string | null;
};
type WorkflowEngineResponse = { ok?: boolean; runId?: string; status?: string; error?: string };
type TravelQueueReplayOutcome =
  | { disposition: "synced" }
  | { disposition: "syncing"; retryAfter?: string };

const ACTIVE_REPLAY_SESSION_STATUSES = new Set([
  "created",
  ...ACTIVE_SESSION_STATUSES,
]);
const COMPLETED_REPLAY_SESSION_STATUSES = new Set(["completed", "complete", "done"]);
const FAILED_REPLAY_SESSION_STATUSES = new Set(["failed", "error", "killed", "orphaned"]);

function queuedModelOverride(payload: Record<string, unknown>): string | null | undefined {
  const hasModelOverride = Object.prototype.hasOwnProperty.call(payload, "modelOverride");
  const metadata = record(payload.responseMetadata);
  const modelSource = metadata.modelSource;
  const queuedModel = hasModelOverride
    ? payload.modelOverride
    : modelSource === "runtime-default"
      ? ""
      : modelSource === "global-default" ||
          modelSource === "familiar-default" ||
          modelSource === "session" ||
          modelSource === "next-message"
        ? metadata.desiredModel ?? metadata.model
        : undefined;
  if (queuedModel === undefined) return undefined;
  if (queuedModel === "") return "";
  const model = cleanModelId(queuedModel);
  if (!model) throw new Error("queued chat model id is not safe for launch");
  return model;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function queuedRuntime(payload: Record<string, unknown>): string | null {
  const metadata = record(payload.responseMetadata);
  return stringValue(metadata.runtime);
}

/**
 * The hub daemon's session endpoint currently accepts model selection but not
 * per-turn control families. Do not let a replay appear synced after the JSON
 * parser silently ignores those fields.
 */
export function daemonReplayControlFamilies(payload: Record<string, unknown>): string[] {
  const families = new Set<string>();
  if (stringValue(payload.reasoningEffort)) families.add("reasoning");
  if (stringValue(payload.responseSpeed)) families.add("performance");
  const modelControls = record(payload.modelControls);
  const knownFamilies = new Set([
    "reasoning",
    "performance",
    "verbosity",
    "output-limit",
    "modalities",
    "tool-support",
  ]);
  for (const [family, value] of Object.entries(modelControls)) {
    if (value === undefined || value === null || value === "") continue;
    families.add(knownFamilies.has(family) ? family : "model-controls");
  }
  return [...families];
}

function replayError(err: unknown): string {
  return err instanceof Error ? err.message : "sync failed";
}

function daemonError(res: { status: number; error?: string; data: unknown }): string {
  return extractDaemonError({ ok: false, status: res.status, data: res.data, error: res.error }) ??
    res.error ??
    `daemon http ${res.status}`;
}

function replayPromotableConversationId(
  replaySessionId: string | null | undefined,
  conversationId: string | null | undefined,
): string | undefined {
  const normalized = normalizeDaemonConversationId(conversationId);
  return normalized && normalized !== replaySessionId ? normalized : undefined;
}

function replaySessionStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function retryAfterSecondsValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.max(1, Math.floor(value)));
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return String(Math.max(1, Number(trimmed)));
}

function retryAfterIso(retryAfter: string, now = new Date()): string {
  return new Date(now.getTime() + Number(retryAfter) * 1000).toISOString();
}

function replayRetryAfterIso(payload: Record<string, unknown>): string | null {
  const value = stringValue(payload.retryAfterUntil);
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

function queueChatSessionId(item: CaveTravelQueueItem): string | null {
  if (item.kind !== "chat") return null;
  return stringValue(record(item.payload).sessionId);
}

async function updateOfflineTravelRetryAfter(
  item: CaveTravelQueueItem,
  payload: Record<string, unknown>,
  retryAfter?: string,
): Promise<void> {
  const nextPayload = { ...payload };
  if (retryAfter) {
    nextPayload.retryAfterUntil = retryAfterIso(retryAfter);
  } else {
    delete nextPayload.retryAfterUntil;
  }
  await updateOfflineTravelItemPayload(item.id, nextPayload);
}

async function reconcileQueuedChatReplay(args: {
  item: CaveTravelQueueItem;
  payload: Record<string, unknown>;
  sessionId: string;
  replaySessionId: string;
  knownResumeConversationId: string | null;
}): Promise<TravelQueueReplayOutcome> {
  const res = await callDaemon<DaemonSessionResponse>({
    path: `/api/v1/sessions/${encodeURIComponent(args.replaySessionId)}`,
  });
  if (!res.ok || !res.data) {
    throw new Error(
      res.status === 404
        ? `daemon replay session ${args.replaySessionId} is no longer available; Cave cannot verify this queued chat replay safely`
        : `Cave could not reconcile queued replay session ${args.replaySessionId}: ${daemonError(res)}`,
    );
  }

  const status = replaySessionStatus(res.data.status);
  const daemonConversationId = replayPromotableConversationId(
    args.replaySessionId,
    stringValue(res.data.conversationId) ?? stringValue(res.data.conversation_id),
  );
  const retryAfter = retryAfterSecondsValue(res.data.retryAfter)
    ?? retryAfterSecondsValue(res.data.retry_after)
    ?? "2";

  await updateOfflineTravelItemPayload(args.item.id, {
    ...args.payload,
    replaySessionId: args.replaySessionId,
    ...(daemonConversationId ? { conversationId: daemonConversationId } : {}),
    ...(args.knownResumeConversationId ? { resumeConversationId: args.knownResumeConversationId } : {}),
    ...(retryAfter ? { retryAfterUntil: retryAfterIso(retryAfter) } : {}),
  });

  if (status === "idle") {
    if (!daemonConversationId) {
      throw new Error(
        `daemon replay session ${args.replaySessionId} is idle without a resumable native conversation id; Cave refuses to mark this chat synced and risk forking continuity`,
      );
    }
    await persistResolvedReplayConversationId({
      sessionId: args.sessionId,
      replaySessionId: args.replaySessionId,
      conversationId: daemonConversationId,
      status: res.data.status ?? null,
      updatedAt: res.data.updated_at ?? null,
    });
    await updateOfflineTravelRetryAfter(args.item, {
      ...args.payload,
      replaySessionId: args.replaySessionId,
      conversationId: daemonConversationId,
      ...(args.knownResumeConversationId ? { resumeConversationId: args.knownResumeConversationId } : {}),
    });
    return { disposition: "synced" };
  }

  if (ACTIVE_REPLAY_SESSION_STATUSES.has(status)) {
    return { disposition: "syncing", retryAfter };
  }

  if (COMPLETED_REPLAY_SESSION_STATUSES.has(status)) {
    if (!daemonConversationId) {
      throw new Error(
        `daemon replay session ${args.replaySessionId} completed without a resumable native conversation id; Cave refuses to mark this chat synced and risk forking continuity`,
      );
    }
    await persistResolvedReplayConversationId({
      sessionId: args.sessionId,
      replaySessionId: args.replaySessionId,
      conversationId: daemonConversationId,
      status: res.data.status ?? null,
      updatedAt: res.data.updated_at ?? null,
    });
    await updateOfflineTravelRetryAfter(args.item, {
      ...args.payload,
      replaySessionId: args.replaySessionId,
      conversationId: daemonConversationId,
      ...(args.knownResumeConversationId ? { resumeConversationId: args.knownResumeConversationId } : {}),
    });
    return { disposition: "synced" };
  }

  if (FAILED_REPLAY_SESSION_STATUSES.has(status)) {
    throw new Error(
      `daemon replay session ${args.replaySessionId} ended ${status}; queued chat replay needs attention before later turns can launch`,
    );
  }

  throw new Error(
    `daemon replay session ${args.replaySessionId} finished in unsupported status '${status || "unknown"}'; Cave cannot confirm replay continuity safely`,
  );
}

async function spawnHubSession(args: {
  config: CaveConfig;
  familiarId: string | null;
  harness: string;
  prompt: string;
  conversationId?: string | null;
  model?: string | null;
  modelOverrideScope?: "runtime-default";
  reasoningEffort?: string | null;
  responseSpeed?: string | null;
  modelControls?: Record<string, unknown>;
  projectRoot?: string | null;
  title: string;
}): Promise<{ replaySessionId: string; conversationId: string | null }> {
  const harness = canonicalHarnessId(args.harness);
  if (!isAllowedHarness(harness)) {
    throw new Error(`harness '${harness}' can't run as an agent session`);
  }
  const projectRoot = normalizeProjectRoot(args.projectRoot ?? process.cwd());
  if (!projectRoot) throw new Error("invalid project root");

  const res = await callDaemon<DaemonSessionResponse>({
    method: "POST",
    path: "/api/v1/sessions",
    body: {
      projectRoot,
      harness,
      prompt: args.prompt,
      launchMode: "nonInteractive",
      ...(args.conversationId
        ? {
          conversation: { mode: "resume", id: args.conversationId },
          conversationId: args.conversationId,
        }
        : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.modelOverrideScope ? { modelOverrideScope: args.modelOverrideScope } : {}),
      ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
      ...(args.responseSpeed ? { responseSpeed: args.responseSpeed } : {}),
      ...(Object.keys(args.modelControls ?? {}).length ? { modelControls: args.modelControls } : {}),
      ...(args.familiarId ? { familiarId: args.familiarId } : {}),
    },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
    throw new Error(daemonError(res));
  }
  const replaySessionId = res.data.id;
  const conversationId = stringValue(res.data.conversationId) ?? stringValue(res.data.conversation_id);

  await Promise.all([
    args.familiarId ? recordSessionFamiliar(replaySessionId, args.familiarId) : Promise.resolve(),
    setSessionTitle(replaySessionId, args.title),
  ]);
  return { replaySessionId, conversationId };
}

async function replayChat(item: CaveTravelQueueItem, config: CaveConfig): Promise<TravelQueueReplayOutcome> {
  const payload = record(item.payload);
  const familiarId = stringValue(payload.familiarId);
  const prompt = stringValue(payload.prompt);
  if (!familiarId || !prompt) throw new Error("queued chat payload missing familiarId or prompt");
  const controlFamilies = daemonReplayControlFamilies(payload);
  if (controlFamilies.length) {
    throw new Error(
      `queued model controls cannot be replayed through the current hub session contract (${controlFamilies.join(", ")})`,
    );
  }
  const runtime = queuedRuntime(payload);
  if (runtime?.startsWith("ssh:")) {
    throw new Error("queued SSH-runtime chat cannot be replayed as a local hub session");
  }
  const runtimeCwd = runtime?.startsWith("local:") ? stringValue(runtime.slice("local:".length)) : null;
  const payloadProjectRoot = stringValue(payload.projectRoot);
  const projectRoot = payloadProjectRoot ?? runtimeCwd ?? process.cwd();
  const allowLocalRuntimeCwd = normalizeProjectRoot(projectRoot) === normalizeProjectRoot(process.cwd());
  await assertProjectRootAccess({ familiarId }, projectRoot, "chat", {
    allowUnregisteredRoot: allowLocalRuntimeCwd,
  });

  const binding = bindingFor(config, familiarId);
  if (canonicalHarnessId(binding.harness) === "copilot") {
    throw new Error(
      "Offline Copilot replay cannot safely use the daemon's non-interactive session API yet. Reconnect to the hub, reopen this chat online, and retry so Cave can resume Copilot through its supported live path.",
    );
  }
  const modelOverride = queuedModelOverride(payload);
  if (modelOverride && !isModelAllowedByRuntime(binding.harness, modelOverride)) {
    throw new Error("queued chat model id is not allowed by the selected runtime");
  }
  const queuedMetadata = record(payload.responseMetadata);
  const queuedHarness = stringValue(queuedMetadata.harness);
  if (
    queuedHarness &&
    canonicalHarnessId(queuedHarness) !== canonicalHarnessId(binding.harness)
  ) {
    throw new Error("queued chat runtime binding changed while offline; choose the runtime again before replaying");
  }
  if (runtime?.startsWith("local:") && isSshRuntime(binding.runtime)) {
    throw new Error("queued local-runtime chat cannot be replayed after this familiar moved to SSH");
  }
  const profileBlock = hermesProfileDaemonLaunchBlockReason(binding);
  if (profileBlock) throw new Error(profileBlock);
  const attachments = objectArray<ChatAttachment>(payload.attachments);
  const queuedPayloadModelOverride = stringValue(payload.modelOverride);
  const queuedRunId = stringValue(payload.runId);
  const replayPrompt = buildPromptWithAttachments(prompt, attachments, { imagesSupported: false });
  const sessionId = stringValue(payload.sessionId) ?? item.id;
  const existingConversation = await loadConversation(sessionId).catch(() => null);
  const nativeConversationId =
    validatedConversationHarnessSessionId(existingConversation)
    ?? latestValidatedReplayConversationId(existingConversation);
  let replaySessionId = stringValue(payload.replaySessionId) ?? stringValue(payload.harnessSessionId);
  let conversationId = replayPromotableConversationId(replaySessionId, stringValue(payload.conversationId)) ?? null;
  const knownResumeConversationId =
    replayPromotableConversationId(replaySessionId, stringValue(payload.resumeConversationId))
    ?? replayPromotableConversationId(replaySessionId, nativeConversationId)
    ?? null;
  if (!replaySessionId) {
    const spawned = await spawnHubSession({
      config,
      familiarId,
      harness: binding.harness,
      prompt: replayPrompt,
      conversationId: nativeConversationId,
      // Preserve the distinction between an omitted model and an explicit
      // runtime-default request. The daemon receives no model argument in both
      // cases, while the scope marker prevents this replay path from treating a
      // cleared model as an accidental static/catalog fallback.
      model: modelOverride,
      ...(payload.modelOverrideScope === "runtime-default"
        ? { modelOverrideScope: "runtime-default" as const }
        : {}),
      reasoningEffort: stringValue(payload.reasoningEffort),
      responseSpeed: stringValue(payload.responseSpeed),
      modelControls: record(payload.modelControls),
      projectRoot,
      title: chatTitleFromPrompt(prompt) ?? defaultChatTitleForSession(stringValue(payload.sessionId) ?? item.id),
    });
    replaySessionId = spawned.replaySessionId;
    conversationId = replayPromotableConversationId(replaySessionId, spawned.conversationId) ?? null;
    payload.replaySessionId = replaySessionId;
    delete payload.harnessSessionId;
    if (conversationId) payload.conversationId = conversationId;
    if (knownResumeConversationId) payload.resumeConversationId = knownResumeConversationId;
    await updateOfflineTravelRetryAfter(item, payload);
  }
  await persistQueuedOfflineConversation({
    sessionId,
    familiarId,
    harness: binding.harness,
    ...(Object.prototype.hasOwnProperty.call(queuedMetadata, "model")
      ? { model: stringValue(queuedMetadata.model) ?? undefined }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(queuedMetadata, "runtime")
      ? { runtime: stringValue(queuedMetadata.runtime) ?? undefined }
      : {}),
    title: chatTitleFromPrompt(prompt) ?? defaultChatTitleForSession(sessionId),
    createdAt: item.createdAt,
    replaySessionId: replaySessionId ?? undefined,
    conversationId,
    predecessorConversationId: nativeConversationId,
    userTurn: {
      id: stringValue(payload.userTurnId) ?? item.id,
      text: prompt,
      ...(attachments.length ? { attachments } : {}),
      ...(queuedRunId ? { attentionClearOperationId: queuedRunId } : {}),
      ...(stringValue(payload.reasoningEffort)
        ? { reasoningEffort: stringValue(payload.reasoningEffort) as "low" | "medium" | "high" }
        : {}),
      ...(stringValue(payload.responseSpeed)
        ? { responseSpeed: stringValue(payload.responseSpeed) as "fast" | "balanced" | "careful" }
        : {}),
      ...(Object.keys(record(payload.modelControls)).length
        ? { modelControls: record(payload.modelControls) }
        : {}),
      ...(queuedPayloadModelOverride ? { modelOverride: queuedPayloadModelOverride } : {}),
      ...(payload.modelOverrideScope === "runtime-default"
        ? { modelOverrideScope: "runtime-default" as const }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "parentTurnId")
        ? { parentId: payload.parentTurnId as string | null }
        : {}),
    },
  });
  if (replaySessionId && sessionId !== replaySessionId) {
    await setSessionTitle(replaySessionId, chatTitleFromPrompt(prompt) ?? `Travel replay: ${item.summary}`);
  }
  return reconcileQueuedChatReplay({
    item,
    payload: {
      ...payload,
      replaySessionId,
      ...(conversationId ? { conversationId } : {}),
      ...(knownResumeConversationId ? { resumeConversationId: knownResumeConversationId } : {}),
    },
    sessionId,
    replaySessionId,
    knownResumeConversationId,
  });
}

async function workflowForPayload(payload: Record<string, unknown>, body: Record<string, unknown>): Promise<WorkflowSummary | null> {
  const embedded = record(payload.workflow);
  const wantedId = stringValue(body.id) ?? stringValue(embedded.id);
  const wantedPath = stringValue(body.path) ?? stringValue(embedded.path);
  const list = await loadLocalWorkflowList();
  if (!list.ok) return null;
  return list.workflows.find((wf) => (wantedId && wf.id === wantedId) || (wantedPath && wf.path === wantedPath)) ?? null;
}

async function replayWorkflow(item: CaveTravelQueueItem, config: CaveConfig): Promise<void> {
  const payload = record(item.payload);
  const body = record(payload.body);
  const workflow = await workflowForPayload(payload, body);
  if (!workflow) throw new Error("queued workflow payload could not resolve workflow");

  const engine = await callDaemon<WorkflowEngineResponse>({
    method: "POST",
    path: "/api/v1/workflows/run",
    body,
  });
  if (engine.ok) {
    await recordRun({
      workflowId: workflow.id,
      version: workflow.version,
      kind: "execution",
      status: engine.data?.status === "succeeded" ? "succeeded" : engine.data?.status === "failed" ? "failed" : "queued",
      startedAt: new Date().toISOString(),
      steps: [],
      summary: engine.data?.runId ? `replayed daemon run ${engine.data.runId}` : `replayed ${item.id}`,
      source: "daemon",
    });
    return;
  }
  if (engine.status !== 404) throw new Error(daemonError(engine));

  const familiarId = stringValue(body.familiarId) ?? workflow.familiar ?? null;
  const binding = familiarId ? bindingFor(config, familiarId) : { harness: config.defaults.harness };
  const profileBlock = hermesProfileDaemonLaunchBlockReason(binding);
  if (profileBlock) throw new Error(profileBlock);
  const prompt = buildWorkflowRunPrompt(workflow, record(body.inputs));
  const { replaySessionId: sessionId } = await spawnHubSession({
    config,
    familiarId,
    harness: binding.harness,
    prompt,
    projectRoot: stringValue(body.projectRoot),
    title: `Workflow: ${workflow.name ?? workflow.id}`,
  });
  await recordRun({
    workflowId: workflow.id,
    version: workflow.version,
    kind: "execution",
    status: "running",
    startedAt: new Date().toISOString(),
    steps: (workflow.steps ?? []).map((step) => ({ id: step.id, kind: step.kind, status: "ready" as const })),
    summary: `replayed agent session ${sessionId.slice(0, 8)}`,
    source: "cave",
    sessionId,
  });
}

function flowFamiliar(flow: FlowDoc): string | null {
  for (const node of flow.nodes) {
    const familiar = node.params?.familiar;
    if (typeof familiar === "string" && familiar.trim()) return familiar.trim();
  }
  return null;
}

function initialFlowRunStepStatus(
  flow: FlowDoc,
  stepId: string,
  seenActiveAgentStep: { value: boolean },
): FlowRunStepStatus {
  const node = flow.nodes.find((item) => item.id === stepId);
  const def = node ? catalogNode(node.type) : undefined;
  if (def?.isTrigger) return "succeeded";
  if (node?.type.startsWith("input.")) return "succeeded";
  if (!seenActiveAgentStep.value) {
    seenActiveAgentStep.value = true;
    return "running";
  }
  return "pending";
}

function flowExecutionMode(value: unknown): FlowExecutionMode {
  return value === "production" ? "production" : "manual";
}

async function replayFlow(item: CaveTravelQueueItem, config: CaveConfig): Promise<void> {
  const payload = record(item.payload);
  const flow = payload.flow as FlowDoc | undefined;
  if (!flow?.id || !Array.isArray(flow.nodes)) throw new Error("queued flow payload missing flow snapshot");
  const options = record(payload.options);
  const targetNodeId = stringValue(options.targetNodeId) ?? undefined;
  const familiarId = stringValue(payload.familiarId) ?? flowFamiliar(flow);
  const binding = familiarId ? bindingFor(config, familiarId) : { harness: config.defaults.harness };
  const profileBlock = hermesProfileDaemonLaunchBlockReason(binding);
  if (profileBlock) throw new Error(profileBlock);
  const prompt = compileFlowPrompt(flow, {
    targetNodeId,
    triggerInput: options.triggerInput as never,
    mode: options.mode as never,
  });
  const { replaySessionId: sessionId } = await spawnHubSession({
    config,
    familiarId,
    harness: binding.harness,
    prompt,
    projectRoot: stringValue(options.projectRoot),
    title: targetNodeId ? `Flow step: ${flow.name} / ${targetNodeId}` : `Flow: ${flow.name}`,
  });

  const order = targetNodeId ? flowPartialExecutionOrder(flow, targetNodeId) : flowExecutionOrder(flow);
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const customData = extractFlowCustomData(flow);
  const redacted = flowRunRedactsData(flow, options.mode as never);
  const seenActiveAgentStep = { value: false };
  const runFields = {
    flowId: flow.id,
    flowName: flow.name,
    status: "running" as const,
    mode: flowExecutionMode(options.mode),
    ...(Object.keys(customData).length > 0 ? { customData } : {}),
    ...(redacted ? { redacted: true } : {}),
    startedAt: new Date().toISOString(),
    steps: order.map((stepId) => ({
      id: stepId,
      type: byId.get(stepId)?.type ?? "unknown",
      status: initialFlowRunStepStatus(flow, stepId, seenActiveAgentStep),
    })),
    summary: `replayed agent session ${sessionId.slice(0, 8)}`,
    source: "cave" as const,
    sessionId,
    flowSnapshot: flow,
  };
  // The queued placeholder run's id rides in the payload — update that run in
  // place so callers that stored it (research mission iterations, the runs
  // list) keep pointing at the run that actually executes. Fall back to a
  // fresh record for legacy queue items or a placeholder evicted by the cap.
  const placeholderRunId = stringValue(payload.placeholderRunId);
  if (placeholderRunId) {
    const updated = await updateFlowRun(placeholderRunId, runFields);
    if (updated) return;
  }
  await recordFlowRun(runFields);
}

async function replayJob(item: CaveTravelQueueItem): Promise<void> {
  const payload = record(item.payload);
  const automation = record(payload.automation) as Partial<CodexAutomation>;
  if (!automation.id || !automation.name || !Array.isArray(automation.cwds) || typeof automation.prompt !== "string") {
    throw new Error("queued job payload missing automation snapshot");
  }
  await startAutomationRun({
    id: automation.id,
    name: automation.name,
    kind: automation.kind ?? "manual",
    status: automation.status ?? "ACTIVE",
    rrule: automation.rrule ?? null,
    model: automation.model ?? null,
    reasoningEffort: automation.reasoningEffort ?? null,
    executionEnvironment: automation.executionEnvironment ?? null,
    cwds: automation.cwds,
    tags: automation.tags ?? [],
    familiars: automation.familiars ?? [],
    prompt: automation.prompt,
    skillPath: automation.skillPath ?? null,
    scheduleHuman: automation.scheduleHuman ?? "manual",
  });
}

async function replayTravelQueueItem(item: CaveTravelQueueItem, config: CaveConfig): Promise<TravelQueueReplayOutcome> {
  const route = stringValue(record(item.payload).route);
  if (item.kind === "chat") return replayChat(item, config);
  if (item.kind === "workflow" && route === "flow-session") {
    await replayFlow(item, config);
    return { disposition: "synced" };
  }
  if (item.kind === "workflow") {
    await replayWorkflow(item, config);
    return { disposition: "synced" };
  }
  if (item.kind === "job") {
    await replayJob(item);
    return { disposition: "synced" };
  }
  throw new Error(`unsupported travel queue item kind: ${item.kind}`);
}

let syncMutex: Promise<TravelOfflineReplayResult> | null = null;

export function syncOfflineTravelQueue(
  config: CaveConfig,
  options: { maxItems?: number } = {},
): Promise<TravelOfflineReplayResult> {
  if (syncMutex) return syncMutex;
  syncMutex = syncOfflineTravelQueueInner(config, options).finally(() => {
    syncMutex = null;
  });
  return syncMutex;
}

async function syncOfflineTravelQueueInner(
  config: CaveConfig,
  options: { maxItems?: number },
): Promise<TravelOfflineReplayResult> {
  const maxItems = Math.max(1, options.maxItems ?? 10);
  const result: TravelOfflineReplayResult = { attempted: 0, synced: 0, failed: 0, errors: [] };
  if (config.multiHost.mode !== "hub") return result;

  const candidates = await offlineTravelItemsNeedingSync();
  const blockedChatSessions = new Set<string>();
  for (const candidate of candidates) {
    if (result.attempted >= maxItems) break;
    const chatSessionId = queueChatSessionId(candidate);
    if (chatSessionId && blockedChatSessions.has(chatSessionId)) continue;
    const retryAfterUntil = replayRetryAfterIso(record(candidate.payload));
    if (retryAfterUntil && Date.parse(retryAfterUntil) > Date.now()) {
      if (chatSessionId) blockedChatSessions.add(chatSessionId);
      continue;
    }
    const item = await markOfflineTravelItemSyncing(candidate.id);
    if (!item) continue;
    result.attempted += 1;
    try {
      const outcome = await replayTravelQueueItem(item, config);
      if (outcome.disposition === "synced") {
        await completeOfflineTravelItem(item.id);
        result.synced += 1;
        continue;
      }
      if (chatSessionId) blockedChatSessions.add(chatSessionId);
    } catch (err) {
      const error = replayError(err);
      await failOfflineTravelItem(item.id, error);
      result.failed += 1;
      result.errors.push({ id: item.id, error });
      if (chatSessionId) blockedChatSessions.add(chatSessionId);
    }
  }
  return result;
}
