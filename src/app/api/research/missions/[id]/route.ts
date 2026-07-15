import { NextResponse } from "next/server";
import { makeProductionResearchMissionRunner } from "@/lib/server/research-mission-runner";
import {
  isValidResearchMissionId,
  loadResearchMission,
} from "@/lib/server/research-mission-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isValidResearchMissionId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const stored = await loadResearchMission(id);
  if (!stored) {
    return NextResponse.json({ ok: false, error: "research mission not found" }, { status: 404 });
  }
  const runner = makeProductionResearchMissionRunner();
  const flowReconciled = await runner.reconcile(stored);
  const mission = await runner.reconcileAutomation(flowReconciled);
  return NextResponse.json({ ok: true, mission });
}
