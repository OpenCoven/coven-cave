import { NextResponse } from "next/server";
import fs from "node:fs";
import { callDaemon } from "@/lib/coven-daemon";
import { loadState, type CaveState } from "@/lib/cave-config";
import { listConversations } from "@/lib/cave-conversations";
import {
  sweepAutoArchive,
  sweepMergedPrAutoArchive,
} from "@/lib/chat-auto-archive-sweep";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "@/lib/session-list-merge";
import { enrichSessionsWithGitContext } from "@/lib/session-git-enrich";
import { collapseFamiliarWorkspaceSessions } from "@/lib/familiar-workspace-sessions";
import { familiarWorkspacesRoot, readFamiliarWorkspaces } from "@/lib/coven-paths";
import { createSwrCache } from "@/lib/swr-cache";
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

// Stale-while-revalidate cache (cave-5m1c). The old plain 2s TTL sat under
// the workspace's 4s poll, so effectively EVERY poll missed and paid the full
// daemon + git + archive-sweep recompute on the response path. Now a poll
// inside the fresh window is a pure cache hit; a poll after it is served the
// previous payload instantly while one background recompute refreshes it —
// steady-state pollers never wait on the compute. Error payloads are never
// served stale (a transient daemon failure must not pin a 503 for the whole
// stale window), and concurrent callers still share one in-flight compute.
const SESSIONS_LIST_CACHE_MS = 2000;
const SESSIONS_LIST_STALE_SERVE_MS = 30_000;
const sessionsListCache = createSwrCache<SessionsListResult>({
  ttlMs: SESSIONS_LIST_CACHE_MS,
  staleServeMs: SESSIONS_LIST_STALE_SERVE_MS,
  canServeStale: (result) => result.payload.ok,
});

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
 * Rewrite `sessions` to reflect a sweep result: rows archived by the sweep
 * are dropped from the active view and stamped `archived_at` in the archived
 * view, so the rows returned by this request already reflect the sweep.
 */
function applySweptRows(
  sessions: SessionRow[],
  swept: Map<string, string>,
  includeArchived: boolean,
): SessionRow[] {
  if (swept.size === 0) return sessions;
  const next: SessionRow[] = [];
  for (const row of sessions) {
    const archivedAt = swept.get(row.id);
    if (!archivedAt) next.push(row);
    else if (includeArchived) next.push({ ...row, archived_at: archivedAt });
  }
  return next;
}

/**
 * Merged-chat auto-archive sweep, piggybacked on the session list read: any
 * unarchived, non-active session whose branch PR is merged gets archived in
 * cave state. One-shot per (session, PR) — summoning the chat later sticks —
 * and the shared opt-outs (keep marks, extension windows) gate it like the
 * policy sweep. IO wiring lives in @/lib/chat-auto-archive-sweep;
 * best-effort — a sweep failure never breaks the listing.
 */
async function applyMergedPrAutoArchive(
  sessions: SessionRow[],
  state: CaveState,
  includeArchived: boolean,
): Promise<SessionRow[]> {
  return applySweptRows(
    sessions,
    await sweepMergedPrAutoArchive(sessions, state),
    includeArchived,
  );
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
 * Policy auto-archive sweep (idle/external/etc.), piggybacked on the session
 * list read. Sessions due per the configured policy are archived in cave
 * state; the returned rows already reflect the sweep. Best-effort — sweep
 * failures never break the listing.
 */
async function applyAutoArchiveSweep(
  sessions: SessionRow[],
  state: CaveState,
  includeArchived: boolean,
): Promise<SessionRow[]> {
  return applySweptRows(
    sessions,
    await sweepAutoArchive(sessions, state),
    includeArchived,
  );
}

/**
 * Apply the opt-in familiar-workspace collapse to an already-scoped list.
 * Pulled out so both the happy path and the degraded (daemon-down, local-only)
 * path enforce the same opt-in contract — otherwise a local chat created under
 * a familiar-workspace root would leak into the unscoped view while the daemon
 * is unavailable. No-op (and no FS read) when the flag is off.
 */
async function applyFamiliarWorkspaceCollapse(
  sessions: SessionRow[],
  collapseFamiliarWorkspace: boolean,
): Promise<SessionRow[]> {
  if (!collapseFamiliarWorkspace) return sessions;
  return collapseFamiliarWorkspaceSessions(
    sessions,
    familiarWorkspacesRoot(),
    Array.from((await readFamiliarWorkspaces()).values()),
  );
}

async function computeSessionsList(
  includeArchived: boolean,
  familiarId: string | null,
  collapseFamiliarWorkspace: boolean,
): Promise<SessionsListResult> {
  const [res, state, projects] = await Promise.all([
    callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" }),
    loadState(),
    loadProjects(),
  ]);
  const localConversations = await listConversations();
  // Backfill for local-only chat rows (UI chats the daemon never sees):
  // map the conversation's recorded cwd to its registered project root so
  // the sidebar's project groups pick new chats up immediately.
  const projectRootForCwd = (cwd: string) => projectForRoot(cwd, projects)?.root ?? null;
  if (!res.ok || !res.data) {
    const localSessions = await applyAutoArchiveSweep(
      localConversationSessionRows(localConversations, state, includeArchived, projectRootForCwd),
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
              await applyFamiliarWorkspaceCollapse(
                await scopeForFamiliar(localSessions, projects, familiarId),
                collapseFamiliarWorkspace,
              ),
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
      projectRootForCwd,
    }),
    state,
    includeArchived,
  );

  const scoped = await scopeForFamiliar(sessions, projects, familiarId);
  const visible = await applyFamiliarWorkspaceCollapse(scoped, collapseFamiliarWorkspace);
  return {
    payload: {
      ok: true,
      sessions: await applyMergedPrAutoArchive(
        await enrichSessionsWithGitContext(visible),
        state,
        includeArchived,
      ),
    },
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  const collapseFamiliarWorkspace =
    url.searchParams.get("collapseFamiliarWorkspace") === "1";
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id", sessions: [] }, { status: 400 });
  }
  // Cache per (archived, familiar, collapse) — each view differs by its result set.
  const cacheKey = `${includeArchived ? "archived" : "active"}:${familiarId ?? "all"}:${
    collapseFamiliarWorkspace ? "collapse" : "full"
  }`;
  const result = await sessionsListCache.get(cacheKey, () =>
    computeSessionsList(includeArchived, familiarId, collapseFamiliarWorkspace),
  );
  return NextResponse.json(result.payload, result.init);
}
