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
      return NextResponse.json({ ok: true });
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
