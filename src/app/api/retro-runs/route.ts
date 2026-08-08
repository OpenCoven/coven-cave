import { NextResponse } from "next/server";
import { loadRetroRunsSnapshot } from "@/lib/server/retro-runs-snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() || null;
  const result = await loadRetroRunsSnapshot({ familiarId });
  if (result.ok || result.code === "retro_state_unavailable") {
    return NextResponse.json({ ok: true, snapshot: result.snapshot });
  }
  return NextResponse.json({ ok: false, error: result.error, snapshot: result.snapshot });
}
