import { NextResponse } from "next/server";
import { startLocalDaemonOperation } from "@/lib/daemon-start";
import {
  daemonDiagnosticContextFromRequest,
  DAEMON_DIAGNOSTIC_CORRELATION_HEADER,
} from "@/lib/server/daemon-diagnostics";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    restart?: boolean;
    automatic?: boolean;
  } | null;
  const restart = body?.restart === true;
  const automatic = body?.automatic === true;

  // Idempotent start: if a daemon is already serving, don't spawn `coven daemon
  // start`. That subcommand *restarts* the daemon, which fights a supervisor
  // (e.g. a launchd KeepAlive agent) for the socket — the supervisor relaunches
  // its copy while the restart spawns another, churning the socket. A healthy
  // daemon means "start" has nothing to do, so report it as already running.
  const operation = startLocalDaemonOperation({
    restart,
    automatic,
    diagnostics: daemonDiagnosticContextFromRequest(request),
  });
  const result = await operation.result;
  return NextResponse.json(
    { ...result, correlationId: operation.diagnostics.correlationId },
    {
      status: "status" in result ? result.status : 200,
      headers: {
        [DAEMON_DIAGNOSTIC_CORRELATION_HEADER]: operation.diagnostics.correlationId,
      },
    },
  );
}
