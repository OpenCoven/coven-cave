import { NextResponse } from "next/server";
import { readRoutineLog } from "@/lib/server/automation-consumer-reads";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; runId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id, runId } = await params;
  try {
    const log = await readRoutineLog(id, runId);
    if (!log) {
      return NextResponse.json({ ok: false, error: "no log for this run" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...log });
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
