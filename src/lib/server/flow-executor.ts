import { bindingFor, loadConfig, recordSessionFamiliar, setSessionTitle } from "@/lib/cave-config";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
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
import { extractFlowCustomData } from "@/lib/flow/flow-execution-data";
import type { FlowRunRecord } from "@/lib/flows";
import { recordFlowRun } from "@/lib/server/flow-store";
import { isAllowedHarness, normalizeProjectRoot } from "@/lib/server/session-security";

export type StartFlowSessionResult = {
  ok: boolean;
  status?: number;
  executor?: "session";
  sessionId?: string;
  run?: FlowRunRecord;
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

  const prompt = compileFlowPrompt(flow, {
    targetNodeId: options.targetNodeId,
    triggerInput: options.triggerInput,
    mode: options.mode,
  });
  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    body: { projectRoot, harness: binding.harness, prompt, ...(familiarId ? { familiarId } : {}) },
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
      status: "pending" as const,
    })),
    summary: `agent session ${sessionId.slice(0, 8)}`,
    source: "cave",
    sessionId,
    flowSnapshot: flow,
  });

  return { ok: true, run, sessionId, executor: "session" };
}
