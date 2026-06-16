import { NextResponse } from "next/server";
import { transitionCard, type CardLifecycle, LIFECYCLES } from "@/lib/cave-board";
import { emitArchiveNudge } from "@/lib/task-archive-nudge-emit";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { to?: string; reason?: string; retry?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.to || !LIFECYCLES.includes(body.to as CardLifecycle)) {
    return NextResponse.json(
      { ok: false, error: `missing or invalid 'to' (must be one of: ${LIFECYCLES.join(", ")})` },
      { status: 400 },
    );
  }
  try {
    const card = await transitionCard(id, {
      to: body.to as CardLifecycle,
      reason: body.reason,
      retry: body.retry,
    });
    if (!card) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    // End-of-lifecycle: nudge the user to archive the task's chat. Best-effort —
    // never let a nudge failure mask a successful transition.
    if (card.lifecycle === "completed") {
      await emitArchiveNudge(card);
    }
    return NextResponse.json({ ok: true, card });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "transition failed" },
      { status: 409 },
    );
  }
}
