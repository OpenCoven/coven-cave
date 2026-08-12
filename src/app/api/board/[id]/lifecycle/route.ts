import { NextResponse } from "next/server";
import {
  LIFECYCLES,
  OrchestrationValidationError,
  transitionCard,
  type CardLifecycle,
} from "@/lib/cave-board";
import { handleTaskCompletion } from "@/lib/task-archive-nudge-emit";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const body = rawBody as { to?: unknown; reason?: unknown; retry?: unknown };
  if (!body.to || !LIFECYCLES.includes(body.to as CardLifecycle)) {
    return NextResponse.json(
      { ok: false, error: `missing or invalid 'to' (must be one of: ${LIFECYCLES.join(", ")})` },
      { status: 400 },
    );
  }
  if (body.reason !== undefined && typeof body.reason !== "string") {
    return NextResponse.json({ ok: false, error: "invalid reason" }, { status: 400 });
  }
  if (body.retry !== undefined && typeof body.retry !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid retry flag" }, { status: 400 });
  }
  try {
    const card = await transitionCard(id, {
      to: body.to as CardLifecycle,
      reason: body.reason as string | undefined,
      retry: body.retry as boolean | undefined,
    });
    if (!card) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    // End-of-lifecycle: auto-archive the task's chat when the policy opts in,
    // otherwise nudge the user to archive it. Best-effort — never let this
    // mask a successful transition.
    if (card.lifecycle === "completed") {
      await handleTaskCompletion(card);
    }
    return NextResponse.json({ ok: true, card });
  } catch (err) {
    if (err instanceof OrchestrationValidationError) {
      return NextResponse.json(
        { ok: false, error: "orchestration_invalid", errors: err.errors },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "transition failed" },
      { status: 409 },
    );
  }
}
