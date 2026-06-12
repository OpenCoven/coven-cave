import { NextResponse } from "next/server";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { dryRunLocalWorkflow } from "@/lib/workflow-source";
import type { WorkflowDryRunPlan } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const res = await callDaemon<WorkflowDryRunPlan>({
    method: "POST",
    path: "/api/v1/workflows/dry-run",
    body,
  });
  if (res.ok) {
    return NextResponse.json(res.data ?? { ok: false, issues: [] });
  }
  // Daemon has no workflow planner yet (404) or is offline (0): plan locally.
  if (res.status === 404 || res.status === 0) {
    return NextResponse.json(await dryRunLocalWorkflow((body ?? {}) as Record<string, unknown>));
  }
  return NextResponse.json(
    {
      ok: false,
      issues: [],
      error: extractDaemonError(res) ?? `daemon http ${res.status}`,
    },
    { status: res.status },
  );
}
