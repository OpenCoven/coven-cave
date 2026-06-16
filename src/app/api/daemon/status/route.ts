import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { covenWorkspaceRoot } from "@/lib/coven-paths";
import { displayCovenVersion, installedCovenVersion } from "@/lib/coven-version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Health = {
  ok: boolean;
  apiVersion?: string;
  covenVersion?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
};

export async function GET() {
  const res = await callDaemon<Health>({ path: "/api/v1/health", timeoutMs: 1500 });
  const root = covenWorkspaceRoot();
  if (!res.ok || !res.data) {
    return NextResponse.json({
      running: false,
      reason: res.error ?? `http ${res.status}`,
      workspacePath: root,
      projectRoot: root,
    });
  }
  const installedVersion =
    !res.data.covenVersion || res.data.covenVersion === "0.0.0"
      ? await installedCovenVersion()
      : null;
  return NextResponse.json({
    running: true,
    apiVersion: res.data.apiVersion,
    covenVersion: displayCovenVersion({
      daemonVersion: res.data.covenVersion,
      installedVersion,
    }),
    daemon: res.data.daemon,
    workspacePath: root,
    projectRoot: root,
  });
}
