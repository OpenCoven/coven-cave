export type WorkflowPattern =
  | "fan-out-and-synthesize"
  | "classify-and-act"
  | "adversarial-verification"
  | "generate-and-filter"
  | "tournament"
  | "loop-until-done"
  | "sequential"
  | "custom";

export type WorkflowStepKind = "agent" | "skill" | "tool" | "human-gate" | "workflow" | string;

export type WorkflowStepSummary = {
  id: string;
  kind: WorkflowStepKind;
  name?: string;
  uses?: string;
  summary?: string;
  requires?: string[];
  permissions?: string[];
  on_error?: string;
};

export type WorkflowSummary = {
  id: string;
  version: string;
  name?: string;
  summary?: string;
  familiar?: string;
  pattern?: WorkflowPattern | string;
  steps?: WorkflowStepSummary[];
  tags?: string[];
  limits?: {
    max_agents?: number;
    timeout_s?: number;
    cost_ceiling_usd?: number;
  };
  permissions?: string[];
  path?: string;
  validation_state?: "valid" | "warning" | "invalid" | "unknown";
  visibility?: {
    public?: boolean;
    personal?: boolean;
    coven_code?: boolean;
    coven_cave?: boolean;
  };
  /**
   * Where the manifest lives, derived from its on-disk location — not stored in
   * the YAML. `public` manifests are repo templates under `workflows/`;
   * `personal` manifests are private to the user under `~/.coven/workflows/`.
   * The Workflow Studio groups the library by this so the two never blur.
   */
  storage?: "public" | "personal";
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

// Run-history types live here (client-safe) so components never import the
// fs-backed store module; src/lib/workflow-runs.ts type-imports these.
export type WorkflowRunStatus = "plan" | "queued" | "running" | "succeeded" | "failed" | "blocked";

export type WorkflowRunStepRecord = {
  id: string;
  kind: string;
  status: "ready" | "blocked" | "succeeded" | "failed" | "skipped";
};

export type WorkflowRunRecord = {
  id: string;
  workflowId: string;
  version?: string;
  kind: "dry-run" | "execution";
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt?: string;
  steps: WorkflowRunStepRecord[];
  summary?: string;
  source: "cave" | "daemon";
};

export type SaveWorkflowResponse = {
  ok: boolean;
  workflow?: WorkflowSummary;
  validation?: WorkflowValidationResult;
  error?: string;
};

export type RunWorkflowResponse = {
  ok: boolean;
  unavailable?: boolean;
  error?: string;
  run?: WorkflowRunRecord;
};

/** Minimal role shape the studio needs for attach toggles. */
export type WorkflowRoleSummary = {
  id: string;
  name: string;
  familiar: string;
  emoji?: string;
  workflows: string[];
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
  body: { id?: string; path?: string; manifest?: unknown; inputs?: Record<string, unknown> },
  fetchImpl: FetchLike = fetch,
): Promise<WorkflowDryRunPlan> {
  return postJson<WorkflowDryRunPlan>("/api/workflows/dry-run", body, fetchImpl);
}

/** Persist a manifest through the Cave save route. */
export async function saveWorkflow(
  manifest: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<SaveWorkflowResponse> {
  return postJson<SaveWorkflowResponse>("/api/workflows/save", { manifest }, fetchImpl);
}

/** Delete a locally-authored manifest by id or source path. */
export async function deleteWorkflow(
  body: { id?: string; path?: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; error?: string }> {
  return postJson<{ ok: boolean; error?: string }>("/api/workflows/delete", body, fetchImpl);
}

/** Execute through the daemon engine; `unavailable: true` keeps Play guarded. */
export async function runWorkflow(
  body: { id?: string; path?: string; inputs?: Record<string, unknown> },
  fetchImpl: FetchLike = fetch,
): Promise<RunWorkflowResponse> {
  return postJson<RunWorkflowResponse>("/api/workflows/run", body, fetchImpl);
}

/** Newest-first run history, optionally scoped to one workflow. */
export async function listWorkflowRuns(
  workflowId?: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; runs: WorkflowRunRecord[]; error?: string }> {
  const query = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
  const res = await fetchImpl(`/api/workflows/runs${query}`, { cache: "no-store" });
  return res.json() as Promise<{ ok: boolean; runs: WorkflowRunRecord[]; error?: string }>;
}

/** Record a run (the studio snapshots dry-run plans into history). */
export async function recordWorkflowRun(
  input: Omit<WorkflowRunRecord, "id">,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; run?: WorkflowRunRecord; error?: string }> {
  return postJson<{ ok: boolean; run?: WorkflowRunRecord; error?: string }>(
    "/api/workflows/runs",
    input,
    fetchImpl,
  );
}

export type WorkflowNodePositionsMap = Record<string, { x: number; y: number }>;

/** Saved cave-only canvas positions for a workflow. */
export async function loadWorkflowLayout(
  id: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; positions: WorkflowNodePositionsMap | null; error?: string }> {
  const res = await fetchImpl(`/api/workflows/layout?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  return res.json() as Promise<{ ok: boolean; positions: WorkflowNodePositionsMap | null; error?: string }>;
}

/** Persist dragged node positions to the workflow's cave sidecar. */
export async function saveWorkflowLayout(
  id: string,
  positions: WorkflowNodePositionsMap,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; error?: string }> {
  return postJson<{ ok: boolean; error?: string }>("/api/workflows/layout", { id, positions }, fetchImpl);
}

/** Roles flattened to what the attachments panel needs. */
export async function listWorkflowRoles(
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; roles: WorkflowRoleSummary[]; error?: string }> {
  const res = await fetchImpl("/api/roles", { cache: "no-store" });
  const data = (await res.json()) as {
    ok: boolean;
    roles?: Array<WorkflowRoleSummary & Record<string, unknown>>;
    error?: string;
  };
  return {
    ok: data.ok,
    error: data.error,
    roles: (data.roles ?? []).map((role) => ({
      id: role.id,
      name: role.name,
      familiar: role.familiar,
      emoji: role.emoji,
      workflows: Array.isArray(role.workflows) ? role.workflows : [],
    })),
  };
}

/** Attach or detach a workflow on a role (rewrites ROLE.md). */
export async function attachWorkflowToRole(
  body: { roleId: string; familiar: string; workflowId: string; attach: boolean },
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; workflows?: string[]; error?: string }> {
  return postJson<{ ok: boolean; workflows?: string[]; error?: string }>(
    "/api/roles/workflows",
    body,
    fetchImpl,
  );
}

export type WorkflowScheduleRecurrence =
  | { type: "none" }
  | { type: "interval"; everyMs: number }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; days: number[]; hour: number; minute: number };

/**
 * Schedule a workflow as a real inbox reminder (shows up on the Automations
 * surface). This intentionally creates a reminder, not an execution: the
 * daemon has no workflow engine yet, and Cave never pretends one ran.
 */
export async function scheduleWorkflow(
  body: {
    workflow: WorkflowSummary;
    fireAt: string;
    recurrence?: WorkflowScheduleRecurrence;
  },
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; error?: string }> {
  return postJson<{ ok: boolean; error?: string }>(
    "/api/inbox",
    {
      kind: "reminder",
      title: `Run workflow: ${body.workflow.name ?? body.workflow.id}`,
      body: body.workflow.summary,
      fireAt: body.fireAt,
      recurrence: body.recurrence,
      source: "user",
      familiarId: body.workflow.familiar ?? null,
      link: { kind: "url", ref: `cave://workflows/${encodeURIComponent(body.workflow.id)}` },
    },
    fetchImpl,
  );
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
