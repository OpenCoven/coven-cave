import {
  bindingFor,
  completeOfflineTravelItem,
  failOfflineTravelItem,
  markOfflineTravelItemSyncing,
  offlineTravelItemsNeedingSync,
  recordSessionFamiliar,
  setSessionTitle,
  type CaveConfig,
  type CaveTravelQueueItem,
} from "@/lib/cave-config";
import { chatTitleFromPrompt, defaultChatTitleForSession } from "@/lib/cave-chat-titles";
import { buildPromptWithAttachments, type ChatAttachment } from "@/lib/chat-attachments";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import type { CodexAutomation } from "@/lib/codex-automations-types";
import { flowExecutionOrder, flowPartialExecutionOrder, compileFlowPrompt } from "@/lib/flow/flow-compile";
import type { FlowExecutionMode } from "@/lib/flow/flow-compile";
import type { FlowDoc } from "@/lib/flow/flow-doc";
import { catalogNode } from "@/lib/flow/flow-catalog";
import { extractFlowCustomData } from "@/lib/flow/flow-execution-data";
import { flowRunRedactsData } from "@/lib/flow/flow-doc";
import type { FlowRunStepStatus } from "@/lib/flows";
import { startAutomationRun } from "@/lib/server/automation-runner";
import { recordFlowRun } from "@/lib/server/flow-store";
import { assertProjectRootAccess } from "@/lib/project-permissions";
import { isAllowedHarness, normalizeProjectRoot } from "@/lib/server/session-security";
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

type DaemonSessionResponse = { id?: string; status?: string };
type WorkflowEngineResponse = { ok?: boolean; runId?: string; status?: string; error?: string };

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

function replayError(err: unknown): string {
  return err instanceof Error ? err.message : "sync failed";
}

function daemonError(res: { status: number; error?: string; data: unknown }): string {
  return extractDaemonError({ ok: false, status: res.status, data: res.data, error: res.error }) ??
    res.error ??
    `daemon http ${res.status}`;
}

async function spawnHubSession(args: {
  config: CaveConfig;
  familiarId: string | null;
  harness: string;
  prompt: string;
  projectRoot?: string | null;
  title: string;
}): Promise<string> {
  if (!isAllowedHarness(args.harness)) {
    throw new Error(`harness '${args.harness}' can't run as an agent session`);
  }
  const projectRoot = normalizeProjectRoot(args.projectRoot ?? process.cwd());
  if (!projectRoot) throw new Error("invalid project root");

  const res = await callDaemon<DaemonSessionResponse>({
    method: "POST",
    path: "/api/v1/sessions",
    body: {
      projectRoot,
      harness: args.harness,
      prompt: args.prompt,
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

async function replayChat(item: CaveTravelQueueItem, config: CaveConfig): Promise<void> {
  const payload = record(item.payload);
  const familiarId = stringValue(payload.familiarId);
  const prompt = stringValue(payload.prompt);
  if (!familiarId || !prompt) throw new Error("queued chat payload missing familiarId or prompt");

  const runtime = queuedRuntime(payload);
  if (runtime?.startsWith("ssh:")) {
    throw new Error("queued SSH-runtime chat cannot be replayed as a local hub session");
  }
  const runtimeCwd = runtime?.startsWith("local:") ? stringValue(runtime.slice("local:".length)) : null;
  const projectRoot = stringValue(payload.projectRoot) ?? runtimeCwd ?? process.cwd();
  await assertProjectRootAccess({ familiarId }, projectRoot, "chat");

  const binding = bindingFor(config, familiarId);
  const attachments = objectArray<ChatAttachment>(payload.attachments);
  const replayPrompt = buildPromptWithAttachments(prompt, attachments, { imagesSupported: false });
  const sessionId = await spawnHubSession({
    config,
    familiarId,
    harness: binding.harness,
    prompt: replayPrompt,
    projectRoot,
    title: chatTitleFromPrompt(prompt) ?? defaultChatTitleForSession(stringValue(payload.sessionId) ?? item.id),
  });
  if (stringValue(payload.sessionId) && payload.sessionId !== sessionId) {
    await setSessionTitle(sessionId, chatTitleFromPrompt(prompt) ?? `Travel replay: ${item.summary}`);
  }
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
  await recordFlowRun({
    flowId: flow.id,
    flowName: flow.name,
    status: "running",
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
    source: "cave",
    sessionId,
    flowSnapshot: flow,
  });
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

async function replayTravelQueueItem(item: CaveTravelQueueItem, config: CaveConfig): Promise<void> {
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

  const candidates = (await offlineTravelItemsNeedingSync()).slice(0, maxItems);
  for (const candidate of candidates) {
    const item = await markOfflineTravelItemSyncing(candidate.id);
    if (!item) continue;
    result.attempted += 1;
    try {
      await replayTravelQueueItem(item, config);
      await completeOfflineTravelItem(item.id);
      result.synced += 1;
    } catch (err) {
      const error = replayError(err);
      await failOfflineTravelItem(item.id, error);
      result.failed += 1;
      result.errors.push({ id: item.id, error });
    }
  }
  return result;
}
