import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  project_root: string;
  harness: string;
  title: string;
  status: string;
  exit_code: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const res = await callDaemon<SessionRow[]>({ path: "/api/v1/sessions" });
  if (!res.ok || !res.data) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, sessions: [] },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, sessions: res.data });
}
