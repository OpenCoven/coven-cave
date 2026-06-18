import { NextResponse } from "next/server";
import { bindingFor, loadConfig, recordSessionFamiliar, setSessionTitle } from "@/lib/cave-config";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { isAllowedHarness, MAX_SESSION_JSON_BYTES, normalizeProjectRoot } from "@/lib/server/session-security";
import { buildWorkflowRunPrompt } from "@/lib/workflow-run-prompt";
import { recordRun } from "@/lib/workflow-runs";
import { loadLocalWorkflowList } from "@/lib/workflow-source";
import type { WorkflowSummary } from "@/lib/workflows";

export const dynamic = "force-dynamic";

type DaemonRunResponse = {
  ok: boolean;
  runId?: string;
  status?: string;
  error?: string;
};

type RunBody = {
  id?: string;
  path?: string;
  familiarId?: string | null;
  projectRoot?: string | null;
  inputs?: Record<string, unknown>;
};

async function resolveWorkflow(body: RunBody): Promise<WorkflowSummary | null> {
  const list = await loadLocalWorkflowList();
  if (!list.ok) return null;
  return (
    list.workflows.find((wf) => (body.id && wf.id === body.id) || (body.path && wf.path === body.path)) ?? null
  );
}

/**
 * Execute a workflow. Two executors, daemon-first:
 *
 *  1. The daemon's native workflow engine (`/api/v1/workflows/run`), if it ever
 *     lands. Forward-compatible — when present, we use it verbatim.
 *  2. The session executor: when the daemon has no workflow engine (404) but is
 *     reachable, Cave compiles the manifest into an orchestration prompt and
 *     spawns a real agent session (`/api/v1/sessions`) — the same primitive the
 *     board uses to run a card as a task. This is a genuine execution: one
 *     capable agent carries out the plan, the run lands in history with the live
 *     session id, and the chat surface can open it.
 *
 * Only a truly unreachable daemon (status 0, or a session spawn that can't
 * start) yields `unavailable: true`, which keeps the studio's honest plan
 * preview. Cave never fakes an execution.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<RunBody>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  if (!body.id && !body.path) {
    return NextResponse.json({ ok: false, error: "id or path required" }, { status: 400 });
  }

  // 1. Native daemon engine first (forward-compatible).
  const engine = await callDaemon<DaemonRunResponse>({
    method: "POST",
    path: "/api/v1/workflows/run",
    body,
  });

  if (engine.ok) {
    const data = engine.data ?? { ok: true };
    const run = await recordRun({
      workflowId: body.id ?? body.path ?? "unknown",
      kind: "execution",
      status: data.status === "succeeded" ? "succeeded" : data.status === "failed" ? "failed" : "queued",
      startedAt: new Date().toISOString(),
      steps: [],
      summary: data.runId ? `daemon run ${data.runId}` : undefined,
      source: "daemon",
    });
    return NextResponse.json({ ...data, ok: true, run, executor: "engine" });
  }

  // Daemon reachable but no engine → the session executor runs it for real.
  if (engine.status === 404) {
    return runViaSession(body);
  }

  // Daemon unreachable (offline / timeout) → honest unavailable.
  if (engine.status === 0) {
    return NextResponse.json({ ok: false, unavailable: true, error: "daemon offline" });
  }

  return NextResponse.json(
    { ok: false, error: extractDaemonError(engine) ?? `daemon http ${engine.status}` },
    { status: engine.status },
  );
}

/** Spawn a real agent session that carries out the workflow plan. */
async function runViaSession(body: RunBody) {
  const workflow = await resolveWorkflow(body);
  if (!workflow) {
    return NextResponse.json({ ok: false, error: "workflow not found" }, { status: 404 });
  }

  const projectRoot = normalizeProjectRoot(body.projectRoot ?? process.cwd());
  if (!projectRoot) {
    return NextResponse.json({ ok: false, error: "invalid project root" }, { status: 400 });
  }

  const config = await loadConfig();
  const familiarId = body.familiarId ?? workflow.familiar ?? null;
  const binding = familiarId ? bindingFor(config, familiarId) : { harness: config.defaults.harness };
  if (!isAllowedHarness(binding.harness)) {
    return NextResponse.json(
      { ok: false, error: `harness '${binding.harness}' can't run as an agent session` },
      { status: 409 },
    );
  }

  const prompt = buildWorkflowRunPrompt(workflow);
  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    body: { projectRoot, harness: binding.harness, prompt },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
    // Daemon went away between the engine probe and the spawn → honest unavailable.
    if (res.status === 0) {
      return NextResponse.json({ ok: false, unavailable: true, error: "daemon offline" });
    }
    return NextResponse.json(
      { ok: false, error: extractDaemonError(res) ?? res.error ?? `daemon http ${res.status}` },
      { status: res.status || 502 },
    );
  }

  const sessionId = res.data.id;
  await Promise.all([
    familiarId ? recordSessionFamiliar(sessionId, familiarId) : Promise.resolve(),
    setSessionTitle(sessionId, `Workflow: ${workflow.name ?? workflow.id}`),
  ]);

  const run = await recordRun({
    workflowId: workflow.id,
    version: workflow.version,
    kind: "execution",
    status: "running",
    startedAt: new Date().toISOString(),
    steps: (workflow.steps ?? []).map((step) => ({
      id: step.id,
      kind: step.kind,
      status: "ready" as const,
    })),
    summary: `agent session ${sessionId.slice(0, 8)}`,
    source: "cave",
  });

  return NextResponse.json({ ok: true, run, sessionId, executor: "session" });
}
