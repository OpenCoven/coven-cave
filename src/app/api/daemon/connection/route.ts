import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadDaemonConnectionSnapshot } from "@/lib/server/daemon-connection-snapshot";
import { reconcileDaemonTravelHeartbeatSnapshot } from "@/lib/server/daemon-travel-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function stableErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as NodeJS.ErrnoException).code ?? "connection-snapshot");
  }
  return "connection-snapshot";
}

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  try {
    const snapshot = await loadDaemonConnectionSnapshot({ fresh });
    await reconcileDaemonTravelHeartbeatSnapshot(snapshot);
    return NextResponse.json(snapshot);
  } catch (error) {
    const code = stableErrorCode(error);
    console.warn(code);
    return NextResponse.json({
      running: false,
      availability: "status-unavailable",
      reason: "Daemon connection status is temporarily unavailable",
      checkedAt: new Date().toISOString(),
    });
  }
}
