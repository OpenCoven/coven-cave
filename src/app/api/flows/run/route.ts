import { NextResponse } from "next/server";
import { bindingFor, loadConfig, recordSessionFamiliar, setSessionTitle } from "@/lib/cave-config";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { isAllowedHarness, MAX_SESSION_JSON_BYTES, normalizeProjectRoot } from "@/lib/server/session-security";
import { loadFlow, recordFlowRun } from "@/lib/server/flow-store";
import { compileFlowPrompt, flowExecutionOrder, flowRunBlockReason } from "@/lib/flow/flow-compile";
import type { FlowDoc } from "@/lib/flow/flow-doc";

export const dynamic = "force-dynamic";

type RunBody = { id?: string; projectRoot?: string | null };

/** First familiar referenced anywhere in the flow, to attribute the session. */
function flowFamiliar(flow: FlowDoc): string | null {
  for (const node of flow.nodes) {
    const familiar = node.params?.familiar;
    if (typeof familiar === "string" && familiar.trim()) return familiar.trim();
  }
  return null;
}

/**
 * Execute a flow. Like the Workflow Studio, Cave has no native flow engine, so
 * it compiles the graph into an orchestration prompt and spawns one capable
 * agent session (`/api/v1/sessions`) that carries it out, printing
 * `@@step-start/done/fail` markers the Executions tab parses back into per-node
 * progress. An unreachable daemon yields `unavailable: true` (honest — Cave
 * never fakes an execution); the editor falls back to a local preview.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<RunBody>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const { id, projectRoot: rawRoot } = parsed.body;
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const flow = await loadFlow(id);
  if (!flow) return NextResponse.json({ ok: false, error: "flow not found" }, { status: 404 });

  const blocked = flowRunBlockReason(flow);
  if (!blocked.ok) {
    return NextResponse.json({ ok: false, error: blocked.reason }, { status: 400 });
  }

  const projectRoot = normalizeProjectRoot(rawRoot ?? process.cwd());
  if (!projectRoot) {
    return NextResponse.json({ ok: false, error: "invalid project root" }, { status: 400 });
  }

  const config = await loadConfig();
  const familiarId = flowFamiliar(flow);
  const binding = familiarId ? bindingFor(config, familiarId) : { harness: config.defaults.harness };
  if (!isAllowedHarness(binding.harness)) {
    return NextResponse.json(
      { ok: false, error: `harness '${binding.harness}' can't run as an agent session` },
      { status: 409 },
    );
  }

  const prompt = compileFlowPrompt(flow);
  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    body: { projectRoot, harness: binding.harness, prompt, ...(familiarId ? { familiarId } : {}) },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
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
    setSessionTitle(sessionId, `Flow: ${flow.name}`),
  ]);

  const order = flowExecutionOrder(flow);
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const run = await recordFlowRun({
    flowId: flow.id,
    flowName: flow.name,
    status: "running",
    startedAt: new Date().toISOString(),
    steps: order.map((stepId) => ({
      id: stepId,
      type: byId.get(stepId)?.type ?? "unknown",
      status: "pending" as const,
    })),
    summary: `agent session ${sessionId.slice(0, 8)}`,
    source: "cave",
    sessionId,
  });

  return NextResponse.json({ ok: true, run, sessionId, executor: "session" });
}
