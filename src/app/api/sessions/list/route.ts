import { NextResponse } from "next/server";
import fs from "node:fs";
import { callDaemon } from "@/lib/coven-daemon";
import { archiveSessionsForMergedPrs, loadState, type CaveState } from "@/lib/cave-config";
import { listConversations } from "@/lib/cave-conversations";
import {
  MERGED_AUTO_ARCHIVE_DISABLE_ENV,
  mergedChatAutoArchiveDecisions,
} from "@/lib/merged-chat-auto-archive";
import { resolveArchiveNudges } from "@/lib/task-archive-nudge-emit";
import { sweepAutoArchive } from "@/lib/chat-auto-archive-sweep";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "@/lib/session-list-merge";
import { enrichSessionsWithGitContext } from "@/lib/session-git-enrich";
import { loadProjects, projectForRoot } from "@/lib/cave-projects";
import { filterProjectsForFamiliar } from "@/lib/project-permissions";
import { scopeSessionsToFamiliarProjects } from "@/lib/session-project-scope";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import type { SessionInitiator, SessionRow } from "@/lib/types";

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

type SessionsListPayload =
  | {
      ok: true;
      degraded?: boolean;
      error?: string;
      sessions: SessionRow[];
    }
  | {
      ok: false;
      error: string;
      sessions: [];
    };

type SessionsListResult = {
  payload: SessionsListPayload;
  init?: ResponseInit;
};

type SessionsListCacheEntry = {
  expiresAt: number;
  result: SessionsListResult;
};

const SESSIONS_LIST_CACHE_MS = 2000;
let sessionsListCache: Map<string, SessionsListCacheEntry> = new Map();
let sessionsListInFlight: Map<string, Promise<SessionsListResult>> = new Map();

function isTrueProjectCwd(projectRoot: string): boolean {
  const trimmed = projectRoot.trim();
  if (!trimmed) return false;
  try {
    return fs.statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

// Git enrichment (branch/worktree context, diffstat vs base, PR context) lives
// in @/lib/session-git-enrich — fully async so the polled list request never
// blocks the event loop on git subprocesses (cave-n37w).

/**
 * Merged-chat auto-archive sweep, piggybacked on the session list read: any
 * unarchived, non-active session whose branch PR is merged gets archived in
 * cave state, and the rows returned by this request already reflect it
 * (dropped from the active view, stamped `archived_at` in the archived view).
 * One-shot per (session, PR) — summoning the chat later sticks. Best-effort:
 * a sweep failure never breaks the listing.
 */
async function applyMergedPrAutoArchive(
  sessions: SessionRow[],
  state: CaveState,
  includeArchived: boolean,
): Promise<SessionRow[]> {
  try {
    if (process.env[MERGED_AUTO_ARCHIVE_DISABLE_ENV] === "1") return sessions;
    const decisions = mergedChatAutoArchiveDecisions(
      sessions,
      state.mergedPrAutoArchived ?? {},
    );
    if (decisions.length === 0) return sessions;
    const archivedAt = await archiveSessionsForMergedPrs(decisions);
    // Clear any pending "ready to archive" nudges for the swept chats.
    await Promise.allSettled(decisions.map((d) => resolveArchiveNudges(d.sessionId)));
    const archivedIds = new Set(decisions.map((d) => d.sessionId));
    const next: SessionRow[] = [];
    for (const row of sessions) {
      if (!archivedIds.has(row.id)) next.push(row);
      else if (includeArchived) next.push({ ...row, archived_at: archivedAt });
    }
    return next;
  } catch {
    return sessions;
  }
}

/**
 * Scope a session list to a familiar's project grants. Sessions in a known
 * project the familiar lacks access to are dropped; rootless / unknown-project
 * sessions pass through (the "(no project)" bucket). A null/empty familiarId
 * is the unscoped operator view — every session is returned.
 */
async function scopeForFamiliar(
  sessions: SessionRow[],
  projects: Awaited<ReturnType<typeof loadProjects>>,
  familiarId: string | null,
): Promise<SessionRow[]> {
  if (!familiarId) return sessions;
  const permitted = await filterProjectsForFamiliar(projects, familiarId);
  return scopeSessionsToFamiliarProjects(sessions, projects, permitted);
}

/**
 * Auto-archive sweep, piggybacked on the session list read. Sessions due per
 * the configured policy are archived in cave state; the rows returned by this
 * request already reflect the sweep (dropped from the active view, stamped
 * `archived_at` in the archived view). Best-effort — sweep failures never
 * break the listing.
 */
async function applyAutoArchiveSweep(
  sessions: SessionRow[],
  state: CaveState,
  includeArchived: boolean,
): Promise<SessionRow[]> {
  const swept = await sweepAutoArchive(sessions, state);
  if (swept.size === 0) return sessions;
  const next: SessionRow[] = [];
  for (const row of sessions) {
    const archivedAt = swept.get(row.id);
    if (!archivedAt) {
      next.push(row);
    } else if (includeArchived) {
      next.push({ ...row, archived_at: archivedAt });
    }
  }
  return next;
}

async function computeSessionsList(
  includeArchived: boolean,
  familiarId: string | null,
): Promise<SessionsListResult> {
  const [res, state, projects] = await Promise.all([
    callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" }),
    loadState(),
    loadProjects(),
  ]);
  const localConversations = await listConversations();
  if (!res.ok || !res.data) {
    const localSessions = await applyAutoArchiveSweep(
      localConversationSessionRows(localConversations, state, includeArchived),
      state,
      includeArchived,
    );
    if (localSessions.length > 0) {
      return {
        payload: {
          ok: true,
          degraded: true,
          error: res.error ?? `daemon http ${res.status}`,
          sessions: await applyMergedPrAutoArchive(
            await enrichSessionsWithGitContext(
              await scopeForFamiliar(localSessions, projects, familiarId),
            ),
            state,
            includeArchived,
          ),
        },
      };
    }
    return {
      payload: { ok: false, error: res.error ?? `daemon http ${res.status}`, sessions: [] },
      init: { status: 503 },
    };
  }

  function isKnownProjectOrValidDir(projectRoot: string): boolean {
    if (projectForRoot(projectRoot, projects)) return true;
    return isTrueProjectCwd(projectRoot);
  }

  const sessions = await applyAutoArchiveSweep(
    mergeSessionRows({
      daemonSessions: res.data,
      localConversations,
      state,
      includeArchived,
      isValidDaemonProjectRoot: isKnownProjectOrValidDir,
    }),
    state,
    includeArchived,
  );

  const scoped = await scopeForFamiliar(sessions, projects, familiarId);
  return {
    payload: {
      ok: true,
      sessions: await applyMergedPrAutoArchive(
        await enrichSessionsWithGitContext(scoped),
        state,
        includeArchived,
      ),
    },
  };
}

async function cachedSessionsList(
  cacheKey: string,
  includeArchived: boolean,
  familiarId: string | null,
): Promise<SessionsListResult> {
  const now = Date.now();
  const cached = sessionsListCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }
  const inFlight = sessionsListInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = computeSessionsList(includeArchived, familiarId).then((result) => {
    sessionsListCache.set(cacheKey, {
      expiresAt: Date.now() + SESSIONS_LIST_CACHE_MS,
      result,
    });
    return result;
  });
  sessionsListInFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    if (sessionsListInFlight.get(cacheKey) === promise) sessionsListInFlight.delete(cacheKey);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id", sessions: [] }, { status: 400 });
  }
  // Cache per (archived, familiar) — scoped views differ by grant set.
  const cacheKey = `${includeArchived ? "archived" : "active"}:${familiarId ?? "all"}`;
  const result = await cachedSessionsList(cacheKey, includeArchived, familiarId);
  return NextResponse.json(result.payload, result.init);
}
