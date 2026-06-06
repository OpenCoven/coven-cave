import { NextResponse } from "next/server";
import { homedir } from "node:os";
import path from "node:path";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

type Health = {
  ok: boolean;
  apiVersion?: string;
  covenVersion?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
};

function workspaceRoot(): string {
  return (
    process.env.WORKSPACE_ROOT ||
    process.env.NEXT_PUBLIC_WORKSPACE_ROOT ||
    path.join(homedir(), ".openclaw")
  );
}

export async function GET() {
  const res = await callDaemon<Health>({ path: "/api/v1/health", timeoutMs: 1500 });
  const root = workspaceRoot();
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
