import { NextResponse } from "next/server";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { recordRun } from "@/lib/workflow-runs";

export const dynamic = "force-dynamic";

type DaemonRunResponse = {
  ok: boolean;
  runId?: string;
  status?: string;
  error?: string;
};

/**
 * Execute a workflow through the daemon. There is deliberately NO local
 * fallback: when the daemon has no workflow engine (404) or is offline (0),
 * the response carries `unavailable: true` and the studio keeps Play guarded —
 * Cave never pretends an execution happened.
 */
export async function POST(req: Request) {
  let body: { id?: string; path?: string; inputs?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.id && !body.path) {
    return NextResponse.json({ ok: false, error: "id or path required" }, { status: 400 });
  }

  const res = await callDaemon<DaemonRunResponse>({
    method: "POST",
    path: "/api/v1/workflows/run",
    body,
  });

  if (res.status === 404 || res.status === 0) {
    return NextResponse.json({
      ok: false,
      unavailable: true,
      error: "daemon workflow engine unavailable",
    });
  }

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: extractDaemonError(res) ?? `daemon http ${res.status}` },
      { status: res.status },
    );
  }

  const data = res.data ?? { ok: true };
  // The daemon accepted the execution — make it part of local run history.
  const run = await recordRun({
    workflowId: body.id ?? body.path ?? "unknown",
    kind: "execution",
    status: data.status === "succeeded" ? "succeeded" : data.status === "failed" ? "failed" : "queued",
    startedAt: new Date().toISOString(),
    steps: [],
    summary: data.runId ? `daemon run ${data.runId}` : undefined,
    source: "daemon",
  });
  return NextResponse.json({ ...data, ok: true, run });
}
