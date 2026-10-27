import { NextResponse } from "next/server";
import { installedCovenVersion } from "@/lib/coven-version";
import {
  buildDaemonDiagnosticBundle,
  listDaemonDiagnosticEvents,
} from "@/lib/server/daemon-diagnostics";
import { readEventPlaneDiagnostics } from "@/lib/server/cave-event-plane-publisher";
import { daemonLifecycleOperation } from "@/lib/server/daemon-lifecycle-owner";
import { daemonMutationOwnerSnapshot } from "@/lib/server/daemon-mutation-owner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const bundle = buildDaemonDiagnosticBundle({
    events: listDaemonDiagnosticEvents(),
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      caveVersion: await installedCovenVersion(),
    },
    // Owner bookkeeping only (#6298): no probe runs, so exporting never
    // changes the lifecycle it describes.
    lifecycle: {
      operation: daemonLifecycleOperation(),
      mutation: daemonMutationOwnerSnapshot(),
    },
  });
  // Aggregate event-plane counters only (#5862): no credentials, entity ids,
  // cursors or payloads.
  return NextResponse.json({ ...bundle, eventPlane: readEventPlaneDiagnostics() }, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="coven-cave-daemon-diagnostics.json"',
    },
  });
}
