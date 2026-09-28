import { NextResponse } from "next/server";
import { listRoutineRuns } from "@/lib/server/coven-automations-client";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";
import { toAutomationRunRecord } from "@/lib/coven-automations-facade";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const runs = await listRoutineRuns(id);
    return NextResponse.json({ ok: true, runs: runs.map((run) => toAutomationRunRecord(run, id)) });
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
