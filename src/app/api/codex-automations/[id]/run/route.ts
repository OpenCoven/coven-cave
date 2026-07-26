import { NextResponse } from "next/server";
import { enqueueOfflineTravelItem, loadConfig } from "@/lib/cave-config";
import { getCodexAutomation } from "@/lib/codex-automations";
import { recordRun } from "@/lib/automation-runs";
import { startAutomationRun } from "@/lib/server/automation-runner";
import { isLocalOrigin } from "@/lib/server/local-origin";
import { travelLocalQueueStatus } from "@/lib/travel-offline-queue";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const auto = await getCodexAutomation(id);
  if (!auto) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const config = await loadConfig();
  const travelStatus = await travelLocalQueueStatus(config);
  if (travelStatus) {
    const queued = await enqueueOfflineTravelItem({
      kind: "job",
      summary: `Automation: ${auto.name}`,
      payload: {
        route: `/api/codex-automations/${auto.id}/run`,
        automation: {
          id: auto.id,
          name: auto.name,
          model: auto.model,
          cwds: auto.cwds,
          familiars: auto.familiars,
          prompt: auto.prompt,
        },
      },
    });
    const run = await recordRun({
      automationId: auto.id,
      automationName: auto.name,
      startedAt: queued.createdAt,
      status: "queued",
      summary: `queued offline ${queued.id}`,
    });
    return NextResponse.json({
      ok: true,
      queued: true,
      queueItem: queued,
      run,
      executor: "travel-queue",
      travel: { reason: travelStatus.reason },
    });
  }
  try {
    const run = await startAutomationRun(auto);
    return NextResponse.json({ ok: true, run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "run failed to start";
    const already = msg.includes("already in progress");
    return NextResponse.json({ ok: false, error: msg }, { status: already ? 409 : 500 });
  }
}
