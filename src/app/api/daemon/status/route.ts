import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { covenWorkspaceRoot } from "@/lib/coven-paths";

export const dynamic = "force-dynamic";

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
  return NextResponse.json({
    running: true,
    apiVersion: res.data.apiVersion,
    covenVersion: res.data.covenVersion,
    daemon: res.data.daemon,
    workspacePath: root,
    projectRoot: root,
  });
}
