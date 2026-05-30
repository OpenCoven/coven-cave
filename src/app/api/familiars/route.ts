import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await callDaemon({ path: "/api/v1/familiars" });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, familiars: [] },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, familiars: res.data ?? [] });
}
