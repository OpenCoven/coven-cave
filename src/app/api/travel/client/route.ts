import { NextResponse } from "next/server";
import { loadConfig, loadState, setManualTravelMode } from "@/lib/cave-config";
import { deriveTravelClientStatus } from "@/lib/travel-client-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [config, state] = await Promise.all([loadConfig(), loadState()]);
  const status = deriveTravelClientStatus({
    multiHost: config.multiHost,
    travel: state.travel,
    hubReachable: null,
  });
  return NextResponse.json({ ok: true, travel: state.travel, status, localBindHost: state.travel.localBindHost });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as { manualOffline?: unknown } | null;
  await setManualTravelMode(body?.manualOffline === true);
  const [config, state] = await Promise.all([loadConfig(), loadState()]);
  const status = deriveTravelClientStatus({
    multiHost: config.multiHost,
    travel: state.travel,
    hubReachable: null,
  });
  return NextResponse.json({ ok: true, travel: state.travel, status, localBindHost: state.travel.localBindHost });
}
