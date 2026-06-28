import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { enqueueManualEvalGroupRun, listManualEvalQueue } from "@/lib/server/eval-store";
import type { EvalGroup, ThreadEvalState } from "@/lib/evals/eval-model";

export const dynamic = "force-dynamic";

const MAX_QUEUE_JSON_BYTES = 1_000_000;

export async function GET() {
  const queue = await listManualEvalQueue();
  return NextResponse.json({ ok: true, queue });
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{ group?: EvalGroup; states?: ThreadEvalState[] }>(req, MAX_QUEUE_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const { group, states } = parsed.body;
  if (!group || typeof group.id !== "string" || !Array.isArray(states)) {
    return NextResponse.json({ ok: false, error: "group and states required" }, { status: 400 });
  }
  try {
    const queued = await enqueueManualEvalGroupRun(group, states);
    return NextResponse.json({ ok: true, queued });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "queue failed" },
      { status: 400 },
    );
  }
}
