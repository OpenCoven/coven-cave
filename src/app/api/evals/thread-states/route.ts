import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { listThreadEvalSnapshots, saveThreadEvalSnapshot } from "@/lib/server/eval-store";
import type { ThreadEvalSnapshot } from "@/lib/evals/eval-model";

export const dynamic = "force-dynamic";

const MAX_THREAD_STATE_JSON_BYTES = 1_000_000;

export async function GET() {
  const snapshots = await listThreadEvalSnapshots();
  return NextResponse.json({ ok: true, snapshots });
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{ snapshot?: ThreadEvalSnapshot }>(req, MAX_THREAD_STATE_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const snapshot = parsed.body.snapshot;
  if (!snapshot || typeof snapshot.threadId !== "string" || typeof snapshot.familiarId !== "string") {
    return NextResponse.json({ ok: false, error: "snapshot.threadId and snapshot.familiarId required" }, { status: 400 });
  }
  try {
    const saved = await saveThreadEvalSnapshot(snapshot);
    return NextResponse.json({ ok: true, snapshot: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "save failed" },
      { status: 400 },
    );
  }
}
