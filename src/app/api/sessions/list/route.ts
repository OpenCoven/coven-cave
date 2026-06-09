import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { loadState } from "@/lib/cave-config";
import { listConversations } from "@/lib/cave-conversations";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "@/lib/session-list-merge";

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";

  const [res, state] = await Promise.all([
    callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" }),
    loadState(),
  ]);
  const localConversations = await listConversations();
  if (!res.ok || !res.data) {
    const localSessions = localConversationSessionRows(localConversations, state, includeArchived);
    if (localSessions.length > 0) {
      return NextResponse.json({
        ok: true,
        degraded: true,
        error: res.error ?? `daemon http ${res.status}`,
        sessions: localSessions,
      });
    }
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, sessions: [] },
      { status: 503 },
    );
  }

  const sessions = mergeSessionRows({
    daemonSessions: res.data,
    localConversations,
    state,
    includeArchived,
  });

  return NextResponse.json({ ok: true, sessions });
}
