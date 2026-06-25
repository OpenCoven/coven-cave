import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";
import { loadFlow } from "@/lib/server/flow-store";
import { startFlowSession } from "@/lib/server/flow-executor";
import type { FlowDoc } from "@/lib/flow/flow-doc";

export const dynamic = "force-dynamic";

type RunBody = {
  id?: string;
  projectRoot?: string | null;
  targetNodeId?: string | null;
  flowSnapshot?: FlowDoc | null;
};

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
  const targetNodeId =
    typeof parsed.body.targetNodeId === "string" && parsed.body.targetNodeId.trim()
      ? parsed.body.targetNodeId.trim()
      : undefined;
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const flow = await loadFlow(id);
  if (!flow) return NextResponse.json({ ok: false, error: "flow not found" }, { status: 404 });

  const snapshotId = parsed.body.flowSnapshot?.id;
  const runFlowDoc = snapshotId === id && parsed.body.flowSnapshot ? parsed.body.flowSnapshot : flow;
  const result = await startFlowSession(runFlowDoc, { projectRoot: rawRoot, targetNodeId, mode: "manual" });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, unavailable: result.unavailable, error: result.error },
      { status: result.status ?? 200 },
    );
  }
  return NextResponse.json({ ok: true, run: result.run, sessionId: result.sessionId, executor: result.executor });
}
