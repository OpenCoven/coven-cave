import { NextResponse } from "next/server";
import { clearFlowRuns, listFlowRuns, recordFlowRun, updateFlowRun } from "@/lib/server/flow-store";
import type { FlowRunRecord } from "@/lib/flows";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["preview", "running", "succeeded", "failed"]);
const MODES = new Set(["manual", "production"]);

/** Newest-first run history, optionally `?flowId=` filtered. */
export async function GET(req: Request) {
  const flowId = new URL(req.url).searchParams.get("flowId") ?? undefined;
  const runs = await listFlowRuns(flowId);
  return NextResponse.json({ ok: true, runs });
}

/** Record a run (preview snapshots from the editor, live session executions). */
export async function POST(req: Request) {
  let body: Partial<Omit<FlowRunRecord, "id">>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.flowId || typeof body.flowId !== "string") {
    return NextResponse.json({ ok: false, error: "flowId required" }, { status: 400 });
  }
  if (!body.status || !STATUSES.has(body.status)) {
    return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
  }
  const run = await recordFlowRun({
    flowId: body.flowId,
    flowName: typeof body.flowName === "string" ? body.flowName : undefined,
    status: body.status,
    mode: typeof body.mode === "string" && MODES.has(body.mode) ? body.mode : undefined,
    customData: coerceCustomData(body.customData),
    redacted: body.redacted === true ? true : undefined,
    startedAt: typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString(),
    finishedAt: typeof body.finishedAt === "string" ? body.finishedAt : undefined,
    steps: Array.isArray(body.steps) ? body.steps : [],
    summary: typeof body.summary === "string" ? body.summary : undefined,
    source: body.source === "daemon" ? "daemon" : "cave",
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    flowSnapshot: coerceFlowSnapshot(body.flowSnapshot),
  });
  return NextResponse.json({ ok: true, run });
}

/** Patch a run as it finishes (status / steps / finishedAt). */
export async function PATCH(req: Request) {
  let body: { id?: string } & Partial<Omit<FlowRunRecord, "id">>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.id || typeof body.id !== "string") {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  if (body.status && !STATUSES.has(body.status)) {
    return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
  }
  const patch: Partial<Omit<FlowRunRecord, "id">> = {};
  if (body.status) patch.status = body.status;
  if (Array.isArray(body.steps)) patch.steps = body.steps;
  if (typeof body.finishedAt === "string") patch.finishedAt = body.finishedAt;
  if (typeof body.summary === "string") patch.summary = body.summary;
  if (body.redacted === true) patch.redacted = true;
  const run = await updateFlowRun(body.id, patch);
  return NextResponse.json({ ok: Boolean(run), run: run ?? undefined });
}

function coerceCustomData(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([key, data]) => [key, data.trim()]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function coerceFlowSnapshot(value: unknown): FlowRunRecord["flowSnapshot"] {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as FlowRunRecord["flowSnapshot"];
  return typeof snapshot?.id === "string" && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.edges)
    ? snapshot
    : undefined;
}

/** Clear run history — one flow's runs (`?flowId=`) or the whole store. */
export async function DELETE(req: Request) {
  const flowId = new URL(req.url).searchParams.get("flowId") ?? undefined;
  const cleared = await clearFlowRuns(flowId);
  return NextResponse.json({ ok: true, cleared });
}
