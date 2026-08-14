import { NextResponse } from "next/server";
import { installedCovenVersion } from "@/lib/coven-version";
import {
  buildDaemonDiagnosticBundle,
  listDaemonDiagnosticEvents,
} from "@/lib/server/daemon-diagnostics";

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
  });
  return NextResponse.json(bundle, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="coven-cave-daemon-diagnostics.json"',
    },
  });
}
