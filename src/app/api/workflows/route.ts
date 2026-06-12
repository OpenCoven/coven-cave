import { NextResponse } from "next/server";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { loadLocalWorkflowList } from "@/lib/workflow-source";
import type { WorkflowListResponse } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await callDaemon<WorkflowListResponse>({ path: "/api/v1/workflows" });
  if (res.ok) {
    return NextResponse.json(res.data ?? { ok: true, workflows: [] });
  }
  // The daemon has no workflow engine yet (404) or is offline (status 0):
  // serve locally-authored manifests so the studio still populates.
  if (res.status === 404 || res.status === 0) {
    return NextResponse.json(await loadLocalWorkflowList());
  }
  return NextResponse.json(
    {
      ok: false,
      workflows: [],
      error: extractDaemonError(res) ?? `daemon http ${res.status}`,
    },
    { status: res.status },
  );
}
