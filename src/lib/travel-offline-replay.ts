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
import { buildPromptWithResponseControls } from "@/app/api/chat/send/chat-send-models";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import type { CodexAutomation } from "@/lib/codex-automations-types";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { isSshRuntime } from "@/lib/familiar-runtime";
import { cleanModelId } from "@/lib/chat-model-state";
import { isModelAllowedByRuntime } from "@/lib/runtime-models";
import { loadConversation, persistQueuedOfflineConversation, saveConversation } from "@/lib/cave-conversations";
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
import { decodeReplayAssistantOutput, replayOutputContractForHarness } from "@/lib/travel-replay-output";

export type TravelOfflineReplayResult = {
  attempted: number;
  synced: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
};

type DaemonSessionResponse = { id?: string; status?: string };
type WorkflowEngineResponse = { ok?: boolean; runId?: string; status?: string; error?: string };
type DaemonSessionSummary = {
  id?: string;
  status?: string;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};
type DaemonEventPage = {
  events?: Array<{ kind?: string; payload_json?: string | null; timestamp?: string | null }>;
  next_cursor?: string | null;
};
type ReplayAssistantStatus = {
  status: string | null;
  assistantText: string | null;
  completedAt: string | null;
};
type ReplayTravelQueueOutcome = "complete" | "pending";

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

function canonicalDaemonTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function parseDaemonEventTimestamp(event: { timestamp?: string | null; payload_json?: string | null }): string | null {
  const topLevel = canonicalDaemonTimestamp(event.timestamp);
  if (topLevel) return topLevel;
  if (typeof event.payload_json !== "string" || !event.payload_json.trim()) return null;
  try {
    const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
    return canonicalDaemonTimestamp(payload.timestamp);
  } catch {
    return null;
  }
}

async function loadDaemonSession(harnessSessionId: string): Promise<DaemonSessionSummary | null> {
  const res = await callDaemon<DaemonSessionSummary | { sessions?: DaemonSessionSummary[] }>({
    method: "GET",
    path: `/api/v1/sessions?id=${encodeURIComponent(harnessSessionId)}&include_archived=true`,
    timeoutMs: 8000,
  });
  if (!res.ok) return null;
  if (Array.isArray((res.data as { sessions?: DaemonSessionSummary[] } | null | undefined)?.sessions)) {
    return (res.data as { sessions?: DaemonSessionSummary[] }).sessions?.find((session) => session?.id === harnessSessionId) ?? null;
  }
  const direct = res.data as DaemonSessionSummary | null | undefined;
  return direct?.id === harnessSessionId ? direct : null;
}

async function collectReplayEventPages(harnessSessionId: string): Promise<Array<{ kind?: string; payload_json?: string | null; timestamp?: string | null }>> {
  const events: Array<{ kind?: string; payload_json?: string | null; timestamp?: string | null }> = [];
  let cursor: string | null = null;
  while (true) {
    const path = cursor
      ? `/api/v1/events?session_id=${encodeURIComponent(harnessSessionId)}&cursor=${encodeURIComponent(cursor)}`
      : `/api/v1/events?session_id=${encodeURIComponent(harnessSessionId)}`;
    const res: Awaited<ReturnType<typeof callDaemon<DaemonEventPage>>> = await callDaemon<DaemonEventPage>({
      method: "GET",
      path,
      timeoutMs: 8000,
    });
    if (!res.ok) throw new Error(daemonError(res));
    const pageEvents = Array.isArray(res.data?.events) ? res.data.events : [];
    events.push(...pageEvents);
    cursor = typeof res.data?.next_cursor === "string" && res.data.next_cursor.trim() ? res.data.next_cursor : null;
    if (!cursor) break;
  }
  return events;
}

function replayAssistantMirrorOutcome(status: ReplayAssistantStatus): ReplayTravelQueueOutcome | "missing" {
  const normalized = (status.status ?? "").trim().toLowerCase();
  if (!normalized || normalized === "running" || normalized === "queued" || normalized === "pending") return "pending";
  if (!status.assistantText) return "missing";
  return "complete";
}

async function persistReplayAssistantTurn(args: {
  sessionId: string;
  harnessSessionId: string;
  userTurnId: string;
  assistantText: string;
  payload: Record<string, unknown>;
  familiarId: string;
  isError: boolean;
  completedAt: string | null;
}): Promise<boolean> {
  const metadata = record(args.payload.responseMetadata);
  const metadataHarness = stringValue(metadata.harness);
  const metadataModel = stringValue(metadata.model);
  const metadataRuntime = stringValue(metadata.runtime);
  const conversation = await loadConversation(args.sessionId);
  if (!conversation) return false;
  const existing = conversation.turns.find((turn) => turn.role === "assistant" && turn.parentId === args.userTurnId);
  if (existing) return true;
  const createdAt = args.completedAt ?? new Date().toISOString();
  const turnId = `${args.userTurnId}-assistant`;
  const responseHarness = metadataHarness ?? conversation.harness ?? "claude";
  const responseModel = metadataModel ?? conversation.model ?? "";
  const responseRuntime = metadataRuntime ?? conversation.runtime ?? "";
  conversation.turns.push({
    id: turnId,
    role: "assistant",
    text: args.assistantText,
    createdAt,
    parentId: args.userTurnId,
    ...(args.isError ? { isError: true } : {}),
    responseMetadata: {
      familiarId: args.familiarId,
      harness: responseHarness,
      model: responseModel,
      runtime: responseRuntime,
      ...(args.completedAt
        ? {
            attentionRequest: {
              sessionId: args.sessionId,
              turnId,
              requestedAt: args.completedAt,
              reason: "approval",
            },
          }
        : {}),
    },
  });
  conversation.activeLeafId = turnId;
  conversation.updatedAt = createdAt;
  await saveConversation(conversation);
  return true;
}

async function replayAssistantStatus(args: { harnessSessionId: string; harness: string }): Promise<ReplayAssistantStatus> {
  const session = await loadDaemonSession(args.harnessSessionId);
  const status = stringValue(session?.status) ?? null;
  const events = await collectReplayEventPages(args.harnessSessionId);
  const assistantText = decodeReplayAssistantOutput({
    harness: args.harness,
    ...replayOutputContractForHarness(args.harness),
    events,
  });
  const eventCompletion = [...events].reverse().map((event) => parseDaemonEventTimestamp(event)).find(Boolean) ?? null;
  const completedAt = canonicalDaemonTimestamp(session?.completed_at) ?? canonicalDaemonTimestamp(session?.updated_at) ?? canonicalDaemonTimestamp(session?.created_at) ?? eventCompletion;
  return { status, assistantText, completedAt };
}

async function spawnHubSession(args: {
  config: CaveConfig;
  familiarId: string | null;
  harness: string;
  prompt: string;
  model?: string | null;
  modelOverrideScope?: "runtime-default";
  reasoningEffort?: string | null;
  responseSpeed?: string | null;
  modelControls?: Record<string, unknown>;
  projectRoot?: string | null;
  title: string;
}): Promise<string> {
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

  await Promise.all([
    args.familiarId ? recordSessionFamiliar(res.data.id, args.familiarId) : Promise.resolve(),
    setSessionTitle(res.data.id, args.title),
  ]);
  return res.data.id;
}

async function replayChat(item: CaveTravelQueueItem, config: CaveConfig): Promise<ReplayTravelQueueOutcome> {
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
  const replayPrompt = buildPromptWithResponseControls(
    buildPromptWithAttachments(prompt, attachments, { imagesSupported: false }),
    {},
  );
  let harnessSessionId = stringValue(payload.harnessSessionId);
  if (!harnessSessionId) {
    harnessSessionId = await spawnHubSession({
      config,
      familiarId,
      harness: binding.harness,
      prompt: replayPrompt,
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
    await updateOfflineTravelItemPayload(item.id, { ...payload, harnessSessionId });
  }
  const sessionId = stringValue(payload.sessionId) ?? item.id;
  const userTurnId = stringValue(payload.userTurnId) ?? item.id;
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
    harnessSessionId,
    userTurn: {
      id: userTurnId,
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
  if (sessionId !== harnessSessionId) {
    await setSessionTitle(harnessSessionId, chatTitleFromPrompt(prompt) ?? `Travel replay: ${item.summary}`);
  }
  const mirrored = await replayAssistantStatus({ harnessSessionId, harness: binding.harness });
  const mirrorOutcome = replayAssistantMirrorOutcome(mirrored);
  if (mirrorOutcome === "pending") return "pending";
  if (mirrorOutcome === "missing" || !mirrored.assistantText) {
    throw new Error("replayed session finished without a usable assistant reply to mirror");
  }
  const persisted = await persistReplayAssistantTurn({
    sessionId,
    harnessSessionId,
    userTurnId,
    assistantText: mirrored.assistantText,
    payload,
    familiarId,
    isError: (mirrored.status ?? "").trim().toLowerCase() === "failed",
    completedAt: mirrored.completedAt,
  });
  if (!persisted) {
    throw new Error("replayed assistant reply could not be attached to its queued user turn");
  }
  return "complete";
}

async function workflowForPayload(payload: Record<string, unknown>, body: Record<string, unknown>): Promise<WorkflowSummary | null> {
  const embedded = record(payload.workflow);
  const wantedId = stringValue(body.id) ?? stringValue(embedded.id);
  const wantedPath = stringValue(body.path) ?? stringValue(embedded.path);
  const list = await loadLocalWorkflowList();
  if (!list.ok) return null;
  return list.workflows.find((wf) => (wantedId && wf.id === wantedId) || (wantedPath && wf.path === wantedPath)) ?? null;
}

async function replayWorkflow(item: CaveTravelQueueItem, config: CaveConfig): Promise<ReplayTravelQueueOutcome> {
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
    return "complete";
  }
  if (engine.status !== 404) throw new Error(daemonError(engine));

  const familiarId = stringValue(body.familiarId) ?? workflow.familiar ?? null;
  const binding = familiarId ? bindingFor(config, familiarId) : { harness: config.defaults.harness };
  const profileBlock = hermesProfileDaemonLaunchBlockReason(binding);
  if (profileBlock) throw new Error(profileBlock);
  const prompt = buildWorkflowRunPrompt(workflow, record(body.inputs));
  const sessionId = await spawnHubSession({
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
  return "complete";
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

async function replayFlow(item: CaveTravelQueueItem, config: CaveConfig): Promise<ReplayTravelQueueOutcome> {
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
  const sessionId = await spawnHubSession({
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
    if (updated) return "complete";
  }
  await recordFlowRun(runFields);
  return "complete";
}

async function replayJob(item: CaveTravelQueueItem): Promise<ReplayTravelQueueOutcome> {
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
  return "complete";
}

async function replayTravelQueueItem(item: CaveTravelQueueItem, config: CaveConfig): Promise<ReplayTravelQueueOutcome> {
  const route = stringValue(record(item.payload).route);
  if (item.kind === "chat") return replayChat(item, config);
  if (item.kind === "workflow" && route === "flow-session") return replayFlow(item, config);
  if (item.kind === "workflow") return replayWorkflow(item, config);
  if (item.kind === "job") return replayJob(item);
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
  const blockedChatConversations = new Set<string>();
  for (const candidate of candidates) {
    if (result.attempted >= maxItems) break;
    const chatConversationId = candidate.kind === "chat" ? stringValue(record(candidate.payload).sessionId) ?? candidate.id : null;
    if (chatConversationId && blockedChatConversations.has(chatConversationId)) continue;
    const item = await markOfflineTravelItemSyncing(candidate.id);
    if (!item) continue;
    result.attempted += 1;
    try {
      const outcome = await replayTravelQueueItem(item, config);
      if (outcome === "pending" && chatConversationId) blockedChatConversations.add(chatConversationId);
      if (outcome === "complete") {
        await completeOfflineTravelItem(item.id);
      }
      result.synced += 1;
    } catch (err) {
      const error = replayError(err);
      await failOfflineTravelItem(item.id, error);
      if (chatConversationId) blockedChatConversations.add(chatConversationId);
      result.failed += 1;
      result.errors.push({ id: item.id, error });
    }
  }
  return result;
}
