import { NextResponse } from "next/server";
import fs from "node:fs";
import { callDaemon } from "@/lib/coven-daemon";
import { loadState } from "@/lib/cave-config";
import { listConversations } from "@/lib/cave-conversations";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "@/lib/session-list-merge";
import { loadProjects, projectForRoot } from "@/lib/cave-projects";
import type { SessionInitiator } from "@/lib/types";

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
  initiator?: SessionInitiator;
};

function isTrueProjectCwd(projectRoot: string): boolean {
  const trimmed = projectRoot.trim();
  if (!trimmed) return false;
  try {
    return fs.statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";

  const [res, state, projects] = await Promise.all([
    callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" }),
    loadState(),
    loadProjects(),
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

  function isKnownProjectOrValidDir(projectRoot: string): boolean {
    if (projectForRoot(projectRoot, projects)) return true;
    return isTrueProjectCwd(projectRoot);
  }

  const sessions = mergeSessionRows({
    daemonSessions: res.data,
    localConversations,
    state,
    includeArchived,
    isValidDaemonProjectRoot: isKnownProjectOrValidDir,
  });

  return NextResponse.json({ ok: true, sessions });
}
