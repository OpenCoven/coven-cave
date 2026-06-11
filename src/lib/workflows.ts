export type WorkflowPattern =
  | "fan-out-and-synthesize"
  | "classify-and-act"
  | "adversarial-verification"
  | "generate-and-filter"
  | "tournament"
  | "loop-until-done"
  | "sequential"
  | "custom";

export type WorkflowSummary = {
  id: string;
  version: string;
  name?: string;
  summary?: string;
  familiar?: string;
  pattern?: WorkflowPattern | string;
  path?: string;
  validation_state?: "valid" | "warning" | "invalid" | "unknown";
  visibility?: {
    coven_code?: boolean;
    coven_cave?: boolean;
  };
};

export type WorkflowValidationTier = "schema" | "semantic" | "preflight";

export type WorkflowValidationIssue = {
  code: string;
  path?: string;
  message?: string;
  suggestion?: string;
  tier: WorkflowValidationTier;
};

export type WorkflowValidationResult = {
  ok: boolean;
  schemaVersion?: string | null;
  workflowId?: string | null;
  issues: WorkflowValidationIssue[];
  error?: string;
};

export type WorkflowDryRunPlan = {
  ok: boolean;
  workflowId?: string;
  version?: string;
  steps?: Array<{
    id: string;
    kind: string;
    uses?: string;
    status: "ready" | "blocked";
    blockers?: WorkflowValidationIssue[];
  }>;
  estimates?: {
    maxAgents?: number;
    timeoutS?: number;
    costCeilingUsd?: number;
    requiredCapabilities?: string[];
    requiredExternalAccounts?: string[];
    humanGates?: string[];
  };
  issues?: WorkflowValidationIssue[];
  error?: string;
};

export type WorkflowListResponse = {
  ok: boolean;
  workflows: WorkflowSummary[];
  scanned_at?: string;
  error?: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<{ json: () => Promise<unknown> }>;

export function workflowDetailPath(id: string): string {
  return `/api/workflows/${encodeURIComponent(id)}`;
}

async function postJson<T>(url: string, body: unknown, fetchImpl: FetchLike): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export async function listWorkflows(fetchImpl: FetchLike = fetch): Promise<WorkflowListResponse> {
  const res = await fetchImpl("/api/workflows", { cache: "no-store" });
  return res.json() as Promise<WorkflowListResponse>;
}

export async function validateWorkflow(
  body: { id?: string; path?: string; manifest?: unknown; content?: string },
  fetchImpl: FetchLike = fetch,
): Promise<WorkflowValidationResult> {
  return postJson<WorkflowValidationResult>("/api/workflows/validate", body, fetchImpl);
}

export async function dryRunWorkflow(
  body: { id?: string; path?: string; inputs?: Record<string, unknown> },
  fetchImpl: FetchLike = fetch,
): Promise<WorkflowDryRunPlan> {
  return postJson<WorkflowDryRunPlan>("/api/workflows/dry-run", body, fetchImpl);
}

export function workflowIssueSummary(issues: WorkflowValidationIssue[]): string {
  if (issues.length === 0) return "No validation issues";
  const counts: Record<WorkflowValidationTier, number> = {
    schema: 0,
    semantic: 0,
    preflight: 0,
  };
  for (const issue of issues) counts[issue.tier] += 1;
  return (Object.entries(counts) as Array<[WorkflowValidationTier, number]>)
    .filter(([, count]) => count > 0)
    .map(([tier, count]) => `${count} ${tier}`)
    .join(", ");
}
