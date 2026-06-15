import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.text) {
    return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
  }

  const res = await callDaemon({
    method: "POST",
    path: `/api/v1/sessions/${encodeURIComponent(id)}/input`,
    body: { text: body.text },
    timeoutMs: 4000,
  });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, status: res.status, data: res.data },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
