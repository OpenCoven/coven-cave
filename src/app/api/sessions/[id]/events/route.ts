import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

type CovenEvent = {
  seq: number;
  id: string;
  session_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const afterSeq = url.searchParams.get("afterSeq") ?? "0";
  const limit = url.searchParams.get("limit") ?? "200";

  const res = await callDaemon<{ events: CovenEvent[] }>({
    path: `/api/v1/events?sessionId=${encodeURIComponent(id)}&afterSeq=${encodeURIComponent(afterSeq)}&limit=${encodeURIComponent(limit)}`,
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
