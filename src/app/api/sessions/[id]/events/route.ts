import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { isOwnedSession } from "@/lib/cave-config";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { isValidSessionId } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";

type CovenEvent = {
  seq: number;
  id: string;
  session_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
};

function intParam(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isValidSessionId(id) || !(await isOwnedSession(id))) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const afterSeq = intParam(url.searchParams.get("afterSeq"), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = intParam(url.searchParams.get("limit"), 200, 1, 500);
  if (afterSeq === null || limit === null) {
    return NextResponse.json({ ok: false, error: "invalid event query" }, { status: 400 });
  }

  const res = await callDaemon<{ events: CovenEvent[] }>({
    path: `/api/v1/events?sessionId=${encodeURIComponent(id)}&afterSeq=${afterSeq}&limit=${limit}`,
    timeoutMs: 4000,
  });

  if (!res.ok || !res.data) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, events: res.data.events ?? [] });
}
