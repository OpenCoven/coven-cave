import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { resolveCovenMemoryFullPath } from "@/lib/server/coven-memory-path";

export const dynamic = "force-dynamic";

type DaemonMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
  source_context?: string;
};

export async function GET() {
  const res = await callDaemon<DaemonMemoryEntry[]>({ path: "/api/v1/memory" });
  if (!res.ok || !res.data) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, entries: [] },
      { status: 503 },
    );
  }
  // Attach a validated absolute path so the reader can load full content (the
  // daemon's relative `path` is rejected by /api/memory/file). Undefined when it
  // can't be resolved to an allow-listed file — the UI falls back to the excerpt.
  const entries = res.data.map((entry) => {
    const fullPath = resolveCovenMemoryFullPath(entry);
    return fullPath ? { ...entry, fullPath } : entry;
  });
  return NextResponse.json({ ok: true, entries });
}
