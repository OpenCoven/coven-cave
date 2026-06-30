import {
  bindingFor,
  enqueueOfflineTravelItem,
  loadConfig,
  recordSessionFamiliar,
  setSessionTitle,
  type CaveTravelQueueItem,
} from "@/lib/cave-config";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { catalogNode } from "@/lib/flow/flow-catalog";
import {
  flowRunRedactsData,
  type FlowDoc,
} from "@/lib/flow/flow-doc";
import {
  compileFlowPrompt,
  type FlowExecutionMode,
  flowExecutionOrder,
  flowPartialExecutionOrder,
  flowRunBlockReason,
  type FlowTriggerInput,
} from "@/lib/flow/flow-compile";
import { flowMissingRequiredInputs } from "@/lib/required-inputs";
import { extractFlowCustomData } from "@/lib/flow/flow-execution-data";
import type { FlowRunRecord, FlowRunStepStatus } from "@/lib/flows";
import { recordFlowRun } from "@/lib/server/flow-store";
import { isAllowedHarness, normalizeProjectRoot } from "@/lib/server/session-security";
import { travelLocalQueueStatus } from "@/lib/travel-offline-queue";

export type StartFlowSessionResult = {
  ok: boolean;
  status?: number;
  executor?: "session" | "travel-queue";
  sessionId?: string;
  run?: FlowRunRecord;
  queued?: boolean;
  queueItem?: CaveTravelQueueItem;
  unavailable?: boolean;
  error?: string;
};

/** First familiar referenced anywhere in the flow, to attribute the session. */
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

export async function startFlowSession(
  flow: FlowDoc,
  options: {
    projectRoot?: string | null;
    targetNodeId?: string;
    triggerInput?: FlowTriggerInput;
    mode?: FlowExecutionMode;
  } = {},
): Promise<StartFlowSessionResult> {
  const blocked = flowRunBlockReason(flow, options.targetNodeId);
  if (!blocked.ok) return { ok: false, error: blocked.reason, status: 400 };

  const missingRequired = flowMissingRequiredInputs(flow);
  if (missingRequired.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Provide required input: ${missingRequired.map((m) => m.label).join(", ")}`,
    };
  }

  const projectRoot = normalizeProjectRoot(options.projectRoot ?? process.cwd());
  if (!projectRoot) return { ok: false, error: "invalid project root", status: 400 };

  const config = await loadConfig();
  const familiarId = flowFamiliar(flow);
  const binding = familiarId ? bindingFor(config, familiarId) : { harness: config.defaults.harness };
  if (!isAllowedHarness(binding.harness)) {
    return {
      ok: false,
      error: `harness '${binding.harness}' can't run as an agent session`,
      status: 409,
    };
  }
  const travelStatus = await travelLocalQueueStatus(config);
  if (travelStatus) {
    const order = options.targetNodeId ? flowPartialExecutionOrder(flow, options.targetNodeId) : flowExecutionOrder(flow);
    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    const queued = await enqueueOfflineTravelItem({
      kind: "workflow",
      summary: options.targetNodeId ? `Flow step: ${flow.name} / ${options.targetNodeId}` : `Flow: ${flow.name}`,
      payload: {
        route: "flow-session",
        flow,
        options,
        familiarId,
        harness: binding.harness,
      },
    });
    const run = await recordFlowRun({
      flowId: flow.id,
      flowName: flow.name,
      status: "queued",
      mode: options.mode ?? "manual",
      startedAt: queued.createdAt,
      steps: order.map((stepId) => ({
        id: stepId,
        type: byId.get(stepId)?.type ?? "unknown",
        status: "pending",
      })),
      summary: `queued offline ${queued.id}`,
      source: "cave",
      flowSnapshot: flow,
    });
    return {
      ok: true,
      executor: "travel-queue",
      queued: true,
      queueItem: queued,
      run,
    };
  }

  const prompt = compileFlowPrompt(flow, {
    targetNodeId: options.targetNodeId,
    triggerInput: options.triggerInput,
    mode: options.mode,
  });
  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    // Spawn a plain harness session (no native `familiarId`), the same way task
    // chat does. Passing `familiarId` makes some daemon setups try to run the
    // session *as* that familiar and reject it with "no familiar configured for
    // this harness" when the familiar isn't registered for that harness on the
    // daemon. The familiar is already described in the compiled prompt and is
    // mirrored into cave-state below via recordSessionFamiliar, so attribution
    // and the run→familiar link survive.
    body: { projectRoot, harness: binding.harness, prompt },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
    if (res.status === 0) {
      return { ok: false, unavailable: true, error: "daemon offline" };
    }
    return {
      ok: false,
      error: extractDaemonError(res) ?? res.error ?? `daemon http ${res.status}`,
      status: res.status || 502,
    };
  }

  const sessionId = res.data.id;
  await Promise.all([
    familiarId ? recordSessionFamiliar(sessionId, familiarId) : Promise.resolve(),
    setSessionTitle(
      sessionId,
      options.targetNodeId ? `Flow step: ${flow.name} / ${options.targetNodeId}` : `Flow: ${flow.name}`,
    ),
  ]);

  const order = options.targetNodeId ? flowPartialExecutionOrder(flow, options.targetNodeId) : flowExecutionOrder(flow);
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const customData = extractFlowCustomData(flow);
  const redacted = flowRunRedactsData(flow, options.mode ?? "manual");
  const seenActiveAgentStep = { value: false };
  const run = await recordFlowRun({
    flowId: flow.id,
    flowName: flow.name,
    status: "running",
    mode: options.mode ?? "manual",
    ...(Object.keys(customData).length > 0 ? { customData } : {}),
    ...(redacted ? { redacted: true } : {}),
    startedAt: new Date().toISOString(),
    steps: order.map((stepId) => ({
      id: stepId,
      type: byId.get(stepId)?.type ?? "unknown",
      status: initialFlowRunStepStatus(flow, stepId, seenActiveAgentStep),
    })),
    summary: `agent session ${sessionId.slice(0, 8)}`,
    source: "cave",
    sessionId,
    flowSnapshot: flow,
  });

  return { ok: true, run, sessionId, executor: "session" };
}
