import { NextResponse } from "next/server";
import { listRoutineRuns } from "@/lib/server/coven-automations-client";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const runs = await listRoutineRuns(id);
    // The compatibility shape the UI reads: AutomationRunRecord minus the
    // filesystem logPath (logs now live in the Coven run ledger).
    const mapped = runs.map((run) => ({
      id: run.id,
      automationId: run.automationId,
      automationName: id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
      exitCode: run.exitCode,
      summary: run.logJson ?? undefined,
    }));
    return NextResponse.json({ ok: true, runs: mapped });
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
