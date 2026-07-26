import { NextResponse } from "next/server";
import { startLocalDaemon } from "@/lib/daemon-start";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { restart?: boolean } | null;
  const restart = body?.restart === true;

  // Idempotent start: if a daemon is already serving, don't spawn `coven daemon
  // start`. That subcommand *restarts* the daemon, which fights a supervisor
  // (e.g. a launchd KeepAlive agent) for the socket — the supervisor relaunches
  // its copy while the restart spawns another, churning the socket. A healthy
  // daemon means "start" has nothing to do, so report it as already running.
  const result = await startLocalDaemon({ restart });
  return NextResponse.json(result, { status: "status" in result ? result.status : 200 });
}
