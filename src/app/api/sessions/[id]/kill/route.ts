import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
