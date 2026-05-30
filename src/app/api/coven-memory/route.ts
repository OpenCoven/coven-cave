import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

type DaemonMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
};

export async function GET() {
  const res = await callDaemon<DaemonMemoryEntry[]>({ path: "/api/v1/memory" });
  if (!res.ok || !res.data) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, entries: [] },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, entries: res.data });
}
