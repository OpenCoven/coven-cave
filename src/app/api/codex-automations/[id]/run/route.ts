import { NextResponse } from "next/server";
import { runRoutine } from "@/lib/server/coven-automations-client";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const outcome = await runRoutine(id);
    if (outcome.status === "failed") {
      return NextResponse.json(
        { ok: false, error: outcome.error ?? "run failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      run: {
        id: outcome.runId,
        automationId: id,
        status: "running",
        startedAt: new Date().toISOString(),
        sessionId: outcome.sessionId,
      },
    });
  } catch (err) {
    if (err instanceof CovenAutomationsUnavailableError && err.degraded) {
      return NextResponse.json(
        { ok: false, error: err.message, degraded: true },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
