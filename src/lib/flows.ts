// Flow editor — client API + shared types.
//
// Mirrors workflows.ts: the data types here are client-safe (no node imports)
// so both the browser components and the server store/routes can share them.
// Fetch helpers wrap the /api/flows endpoints.

import type { FlowDoc } from "./flow/flow-doc.ts";
import type { FlowExecutionMode } from "./flow/flow-compile.ts";

export type { FlowDoc, FlowNode, FlowEdge } from "./flow/flow-doc.ts";

export type FlowRunStatus = "preview" | "queued" | "running" | "succeeded" | "failed";

export type FlowRunStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type FlowRunStepRecord = {
  id: string;
  type: string;
  status: FlowRunStepStatus;
  detail?: string;
};

export type FlowRunRecord = {
  id: string;
  flowId: string;
  flowName?: string;
  status: FlowRunStatus;
  /** Manual editor/test runs can use pinned data; production trigger runs ignore it. */
  mode?: FlowExecutionMode;
  /** Saved custom execution data, used for execution-history filtering. */
  customData?: Record<string, string>;
  /** Per-node execution details were intentionally not persisted. */
  redacted?: boolean;
  startedAt: string;
  finishedAt?: string;
  steps: FlowRunStepRecord[];
  summary?: string;
  source: "cave" | "daemon";
  /** Live agent session id when the session executor ran the flow. */
  sessionId?: string;
  /** Exact workflow document used for this execution, for original-workflow retry. */
  flowSnapshot?: FlowDoc;
};

export type FlowListResponse = { ok: boolean; flows?: FlowDoc[]; error?: string };
export type FlowSaveResponse = { ok: boolean; flow?: FlowDoc; error?: string };
export type FlowMutationResponse = { ok: boolean; error?: string };
export type FlowRunsResponse = { ok: boolean; runs: FlowRunRecord[]; error?: string };
export type FlowRunResponse = {
  ok: boolean;
  executor?: "session" | "engine" | "travel-queue";
  sessionId?: string;
  run?: FlowRunRecord;
  queued?: boolean;
  unavailable?: boolean;
  error?: string;
};
export type FlowWebhookListenResponse = {
  ok: boolean;
  method?: string;
  path?: string;
  testUrlPath?: string;
  expiresAt?: string;
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function listFlows(): Promise<FlowListResponse> {
  const response = await fetch("/api/flows", { cache: "no-store" });
  return readJson<FlowListResponse>(response);
}

export async function saveFlow(flow: FlowDoc): Promise<FlowSaveResponse> {
  const response = await fetch("/api/flows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flow }),
  });
  return readJson<FlowSaveResponse>(response);
}

export async function deleteFlow(id: string): Promise<FlowMutationResponse> {
  const response = await fetch(`/api/flows?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  return readJson<FlowMutationResponse>(response);
}

export async function runFlow(id: string, targetNodeId?: string, flowSnapshot?: FlowDoc): Promise<FlowRunResponse> {
  const response = await fetch("/api/flows/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, targetNodeId, flowSnapshot }),
  });
  return readJson<FlowRunResponse>(response);
}

export async function listenFlowWebhookTest(
  flow: FlowDoc,
  triggerId: string,
): Promise<FlowWebhookListenResponse> {
  const response = await fetch("/api/flows/webhook-test/listen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flow, triggerId }),
  });
  return readJson<FlowWebhookListenResponse>(response);
}

export async function listFlowRuns(flowId: string): Promise<FlowRunsResponse> {
  const response = await fetch(`/api/flows/runs?flowId=${encodeURIComponent(flowId)}`, {
    cache: "no-store",
  });
  return readJson<FlowRunsResponse>(response);
}

export async function recordFlowRun(input: Omit<FlowRunRecord, "id">): Promise<{ ok: boolean; run?: FlowRunRecord }> {
  const response = await fetch("/api/flows/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<{ ok: boolean; run?: FlowRunRecord }>(response);
}

export async function updateFlowRun(
  id: string,
  patch: Partial<Pick<FlowRunRecord, "status" | "steps" | "finishedAt" | "summary" | "redacted">>,
): Promise<{ ok: boolean; run?: FlowRunRecord }> {
  const response = await fetch("/api/flows/runs", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });
  return readJson<{ ok: boolean; run?: FlowRunRecord }>(response);
}

export async function clearFlowRuns(flowId: string): Promise<{ ok: boolean; cleared?: number }> {
  const response = await fetch(`/api/flows/runs?flowId=${encodeURIComponent(flowId)}`, {
    method: "DELETE",
  });
  return readJson<{ ok: boolean; cleared?: number }>(response);
}
