import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import type { AfsDiff, AfsFileDiff } from "@/lib/afs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  const path = new URL(req.url).searchParams.get("path");
  const daemonPath =
    `/api/v1/afs/sessions/${encodeURIComponent(id)}/diff` +
    (path === null ? "" : `?path=${encodeURIComponent(path)}`);
  const res = await callDaemon<AfsDiff | AfsFileDiff>({ path: daemonPath });
  if (!res.ok) {
    // Pass the daemon's structured error through rather than flattening it:
    // the dotted code is what the pane renders.
    return NextResponse.json(res.data ?? { error: res.error }, { status: res.status || 502 });
  }
  return NextResponse.json(res.data);
}
