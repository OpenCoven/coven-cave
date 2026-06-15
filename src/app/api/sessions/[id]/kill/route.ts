import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { isOwnedSession } from "@/lib/cave-config";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { isValidSessionId } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isValidSessionId(id) || !(await isOwnedSession(id))) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  const res = await callDaemon({
    method: "POST",
    path: `/api/v1/sessions/${encodeURIComponent(id)}/kill`,
    timeoutMs: 4000,
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
