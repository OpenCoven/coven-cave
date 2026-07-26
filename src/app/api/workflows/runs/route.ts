import { NextResponse } from "next/server";
import { clearRuns, listRuns, recordRun, type WorkflowRunRecord } from "@/lib/workflow-runs";
import type { WorkflowRunStepRecord } from "@/lib/workflows";
import { isLocalOrigin } from "@/lib/server/local-origin";
import {
  resolveRunSource,
  resolveWipe,
  validateSteps,
} from "@/lib/server/run-history-guards";

export const dynamic = "force-dynamic";

const forbidden = () =>
  NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

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
  if (!isLocalOrigin(req)) return forbidden();
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
  const steps = validateSteps<WorkflowRunStepRecord>(body.steps);
  if (!steps.ok) {
    return NextResponse.json({ ok: false, error: steps.error }, { status: 413 });
  }
  const run = await recordRun({
    workflowId: body.workflowId,
    version: typeof body.version === "string" ? body.version : undefined,
    kind: body.kind,
    status: body.status,
    startedAt: typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString(),
    finishedAt: typeof body.finishedAt === "string" ? body.finishedAt : undefined,
    steps: steps.steps,
    summary: typeof body.summary === "string" ? body.summary : undefined,
    source: resolveRunSource(req, body.source),
  });
  return NextResponse.json({ ok: true, run });
}

/** Clear run history — one workflow's runs (`?workflowId=`) or the whole store (`?all=1`). */
export async function DELETE(req: Request) {
  if (!isLocalOrigin(req)) return forbidden();
  const params = new URL(req.url).searchParams;
  const workflowId = params.get("workflowId") ?? undefined;
  const wipe = resolveWipe(workflowId, params);
  if (!wipe.ok) {
    return NextResponse.json({ ok: false, error: wipe.error }, { status: 400 });
  }
  const cleared = await clearRuns(wipe.scopeId);
  return NextResponse.json({ ok: true, cleared });
}
