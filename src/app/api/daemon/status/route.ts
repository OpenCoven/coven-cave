import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/cave-config";
import { callDaemon, daemonTargetForConfig, type DaemonTarget } from "@/lib/coven-daemon";
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

function targetSummary(target: DaemonTarget) {
  if (target.mode === "local") {
    return { mode: target.mode, label: target.label, socket: target.socketPath };
  }
  if (target.mode === "hub") {
    return { mode: target.mode, label: target.label, url: target.url };
  }
  return { mode: target.mode, label: target.label, error: target.error };
}

export async function GET() {
  const config = await loadConfig();
  const target = daemonTargetForConfig(config);
  if (target.mode === "unconfigured-hub") {
    const root = covenWorkspaceRoot();
    return NextResponse.json({
      running: false,
      reason: target.error,
      target: targetSummary(target),
      workspacePath: root,
      projectRoot: root,
    });
  }

  const res = await callDaemon<Health>({ path: "/api/v1/health", timeoutMs: 1500 });
  const root = covenWorkspaceRoot();
  if (!res.ok || !res.data) {
    return NextResponse.json({
      running: false,
      reason: target.mode === "hub" ? `hub unreachable: ${res.error ?? `http ${res.status}`}` : res.error ?? `http ${res.status}`,
      target: targetSummary(target),
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
    target: targetSummary(target),
    workspacePath: root,
    projectRoot: root,
  });
}
