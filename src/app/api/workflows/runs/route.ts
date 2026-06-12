import { NextResponse } from "next/server";
import { listRuns, recordRun, type WorkflowRunRecord } from "@/lib/workflow-runs";

export const dynamic = "force-dynamic";

/** Newest-first run history, optionally `?workflowId=` filtered. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workflowId = url.searchParams.get("workflowId") ?? undefined;
  const runs = await listRuns(workflowId);
  return NextResponse.json({ ok: true, runs });
}

const RUN_KINDS = new Set(["dry-run", "execution"]);
const RUN_STATUSES = new Set(["plan", "queued", "running", "succeeded", "failed", "blocked"]);

/** Record a run (dry-run plan snapshots from the studio, daemon executions). */
export async function POST(req: Request) {
  let body: Partial<Omit<WorkflowRunRecord, "id">>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.workflowId || typeof body.workflowId !== "string") {
    return NextResponse.json({ ok: false, error: "workflowId required" }, { status: 400 });
  }
  if (!body.kind || !RUN_KINDS.has(body.kind)) {
    return NextResponse.json({ ok: false, error: "kind must be dry-run or execution" }, { status: 400 });
  }
  if (!body.status || !RUN_STATUSES.has(body.status)) {
    return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
  }
  const run = await recordRun({
    workflowId: body.workflowId,
    version: typeof body.version === "string" ? body.version : undefined,
    kind: body.kind,
    status: body.status,
    startedAt: typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString(),
    finishedAt: typeof body.finishedAt === "string" ? body.finishedAt : undefined,
    steps: Array.isArray(body.steps) ? body.steps : [],
    summary: typeof body.summary === "string" ? body.summary : undefined,
    source: body.source === "daemon" ? "daemon" : "cave",
  });
  return NextResponse.json({ ok: true, run });
}
