import { NextResponse } from "next/server";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import type { WorkflowListResponse } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await callDaemon<WorkflowListResponse>({ path: "/api/v1/workflows" });
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        workflows: [],
        error: extractDaemonError(res) ?? `daemon http ${res.status}`,
      },
      { status: res.status === 0 ? 503 : res.status },
    );
  }
  return NextResponse.json(res.data ?? { ok: true, workflows: [] });
}
