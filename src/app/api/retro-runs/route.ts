import { NextResponse } from "next/server";
import { buildRetroRunsSnapshot } from "@/lib/retro-runs";
import { loadRetroRunsSnapshot } from "@/lib/server/retro-runs-snapshot";

export const dynamic = "force-dynamic";

type RetroRunsRouteDependencies = {
  loadRetroRunsSnapshot: typeof loadRetroRunsSnapshot;
};

function emptyRetroRunsSnapshot() {
  return buildRetroRunsSnapshot([]);
}

export function createRetroRunsGetHandler(
  dependencies: RetroRunsRouteDependencies,
) {
  return async function GET(req: Request) {
    const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() || null;
    try {
      const result = await dependencies.loadRetroRunsSnapshot({ familiarId });
      if (result.ok || result.code === "retro_state_unavailable") {
        return NextResponse.json({ ok: true, snapshot: result.snapshot });
      }
      return NextResponse.json({ ok: false, error: result.error, snapshot: result.snapshot });
    } catch {
      return NextResponse.json(
        { ok: false, error: "retro_runs_unavailable", snapshot: emptyRetroRunsSnapshot() },
        { status: 503 },
      );
    }
  };
}

const getHandler = createRetroRunsGetHandler({ loadRetroRunsSnapshot });

export async function GET(req: Request) {
  return getHandler(req);
}
