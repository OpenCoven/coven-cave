import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { deleteRun, listRuns, saveRun } from "@/lib/server/eval-store";
import type { EvalRun } from "@/lib/evals/eval-model";

export const dynamic = "force-dynamic";

const MAX_RUN_JSON_BYTES = 4_000_000;

/** List recorded eval runs, optionally filtered by `?suiteId=`. */
export async function GET(req: Request) {
  const suiteId = new URL(req.url).searchParams.get("suiteId") ?? undefined;
  const runs = await listRuns(suiteId || undefined);
  return NextResponse.json({ ok: true, runs });
}

/**
 * Persist a completed run. The run itself is executed client-side (each case
 * goes through /api/chat/send + graders); this only records the result.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{ run?: EvalRun }>(req, MAX_RUN_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const run = parsed.body.run;
  if (!run || typeof run.id !== "string" || !run.id.trim()) {
    return NextResponse.json({ ok: false, error: "run.id required" }, { status: 400 });
  }
  try {
    const saved = await saveRun(run);
    return NextResponse.json({ ok: true, run: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "save failed" },
      { status: 400 },
    );
  }
}

/** Delete a run by `?id=`. */
export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const ok = await deleteRun(id);
  return NextResponse.json({ ok });
}
