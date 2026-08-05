import { NextResponse } from "next/server";
import {
  loadDaemonConnectionSnapshot,
} from "@/lib/server/daemon-connection-snapshot";
import {
  reconcileDaemonTravelHeartbeatSnapshot,
} from "@/lib/server/daemon-travel-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DaemonTravelReconcileRouteDependencies = {
  loadDaemonConnectionSnapshot: typeof loadDaemonConnectionSnapshot;
  reconcileDaemonTravelHeartbeatSnapshot: typeof reconcileDaemonTravelHeartbeatSnapshot;
};

const REPLAY_PENDING_RETRY_MS = 1_000;

function stableErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as NodeJS.ErrnoException).code ?? "daemon-travel-reconcile");
  }
  return "daemon-travel-reconcile";
}

function failureResponse() {
  return NextResponse.json(
    { ok: false, error: "daemon travel reconciliation failed" },
    { status: 503 },
  );
}

function replayRetryAfterMs(
  result: Awaited<ReturnType<DaemonTravelReconcileRouteDependencies["reconcileDaemonTravelHeartbeatSnapshot"]>>,
): number | null {
  if (!result) return null;
  if (!result.travelStatus.handoffPending) return null;
  if (result.travelState.manualOffline || result.travelState.hubUnreachableSince) return null;
  return result.travelState.offlineQueue.some((item) => item.status === "pending" || item.status === "syncing")
    ? REPLAY_PENDING_RETRY_MS
    : null;
}

export function createDaemonTravelReconcilePostHandler(
  dependencies: DaemonTravelReconcileRouteDependencies,
) {
  return async function POST(_request: Request) {
    try {
      const snapshot = await dependencies.loadDaemonConnectionSnapshot();
      const result = await dependencies.reconcileDaemonTravelHeartbeatSnapshot(snapshot);
      if (result?.failure) {
        console.warn(result.failure.code);
        return failureResponse();
      }
      const retryAfterMs = replayRetryAfterMs(result);
      return NextResponse.json({
        ok: true,
        ...(retryAfterMs !== null ? { retryAfterMs } : {}),
      });
    } catch (error) {
      console.warn(stableErrorCode(error));
      return failureResponse();
    }
  };
}

const postHandler = createDaemonTravelReconcilePostHandler({
  loadDaemonConnectionSnapshot,
  reconcileDaemonTravelHeartbeatSnapshot,
});

export async function POST(request: Request) {
  return postHandler(request);
}
