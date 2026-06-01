import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { loadState } from "@/lib/cave-config";
import { inferOrigin } from "@/lib/session-origin";

export const dynamic = "force-dynamic";

type DaemonSession = {
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
  const [res, state] = await Promise.all([
    callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" }),
    loadState(),
  ]);
  if (!res.ok || !res.data) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, sessions: [] },
      { status: 503 },
    );
  }
  const sessions = res.data.map((s) => ({
    ...s,
    familiarId: state.sessionFamiliar[s.id] ?? null,
    origin: inferOrigin(s),
  }));
  return NextResponse.json({ ok: true, sessions });
}
