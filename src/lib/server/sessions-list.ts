/**
 * The reusable session-list computation, lifted out of
 * `src/app/api/sessions/list/route.ts` so a second reader does not have to
 * self-fetch that HTTP route to get the same answer (cave-9rwd.1).
 *
 * The route keeps what is genuinely route-shaped — query parsing, the familiar
 * id guard, and ownership of the shared SWR cache. Everything below is the
 * computation both it and the Familiar dashboard read need.
 *
 * ## Why this takes options rather than being a straight move
 *
 * `computeSessionsList` is named like a read and is not purely one. Two of the
 * things it does are WRITES:
 *
 *   - `sweepAutoArchive` calls `autoArchiveSessionsLocal`, which archives
 *     sessions in cave state;
 *   - `sweepMergedPrAutoArchive` archives merged-PR chats and records the
 *     (session, PR) pair in cave state so the sweep stays one-shot.
 *
 * That is correct and deliberate for `/api/sessions/list`: it is the workspace's
 * 4-second poll, and piggybacking the sweeps on it is what makes them happen at
 * all. It is NOT correct for a dashboard GET. Reusing this verbatim would mean
 * that opening a Familiar hub on a phone silently archives the operator's
 * chats — a mutation with no user gesture behind it, triggered by a read, on a
 * surface that cannot show what it just did.
 *
 * A third piece is not a write but is unbounded work: `enrichSessionsWithGitContext`
 * shells out to `git` (per project root, plus diff calls) — fine amortised
 * across a cached desktop poll, wrong for a bounded mobile read that never
 * renders a branch or a diffstat.
 *
 * So the seam is an options bag, both flags defaulting to the route's existing
 * behaviour. The route passes nothing and is byte-for-byte unchanged in effect;
 * the dashboard opts out of both and gets a genuinely read-only, subprocess-free
 * projection. Splitting it this way — rather than copying the parts the
 * dashboard wants into a second function — keeps ONE implementation of session
 * merging, scoping, and collapse, which is the duplication this extraction
 * exists to prevent.
 */

import fs from "node:fs";
import { callDaemon } from "@/lib/coven-daemon";
import { loadState, type CaveState } from "@/lib/cave-config";
import { listConversations } from "@/lib/cave-conversations";
import { hasActiveChatRun } from "@/lib/server/chat-stop-registry";
import {
  sweepAutoArchive,
  sweepMergedPrAutoArchive,
} from "@/lib/chat-auto-archive-sweep";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "@/lib/session-list-merge";
import { NO_CHAT_ATTENTION } from "@/lib/chat-attention";
import {
  applyStaleRunningPresentation,
  sweepStaleRunningGhosts,
} from "@/lib/server/stale-running-sweep";
import { enrichSessionsWithGitContext } from "@/lib/session-git-enrich";
import {
  classifyFamiliarWorkspaceSessions,
  collapseFamiliarWorkspaceSessions,
} from "@/lib/familiar-workspace-sessions";
import { familiarWorkspacesRoot, readFamiliarWorkspaces } from "@/lib/coven-paths";
import type { SessionsListResult } from "@/lib/server/sessions-list-cache";
import { loadProjects, projectForRoot } from "@/lib/cave-projects";
import { filterProjectsForFamiliar } from "@/lib/project-permissions";
import { scopeSessionsToFamiliarProjects } from "@/lib/session-project-scope";
import type { SessionInitiator, SessionRow } from "@/lib/types";

/**
 * What a caller may switch off. Both default to `true`, which is exactly what
 * `/api/sessions/list` has always done — a caller that passes nothing gets the
 * pre-extraction behaviour.
 */
export type ComputeSessionsListOptions = {
  /**
   * Run the policy and merged-PR auto-archive sweeps. These WRITE cave state.
   * A read-only consumer must pass `false`.
   */
  sweepArchives?: boolean;
  /** Attach git branch/diff/PR context. Spawns `git` subprocesses. */
  enrichGit?: boolean;
  /** Attach trusted familiar-workspace metadata without changing membership. */
  classifyFamiliarWorkspace?: boolean;
};

const DEFAULT_OPTIONS = {
  sweepArchives: true,
  enrichGit: true,
  classifyFamiliarWorkspace: false,
} as const;

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

// Stale-while-revalidate cache (cave-5m1c) + mutation invalidation
// (cave-53yx) live in @/lib/server/sessions-list-cache — a route file may
// only export handlers, and session mutators must be able to bust the cache
// so post-mutation refreshes never serve the pre-mutation list.

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
    else if (includeArchived) next.push({ ...row, archived_at: archivedAt, attention: NO_CHAT_ATTENTION });
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
  sweepArchives: boolean,
): Promise<SessionRow[]> {
  // Skipped wholesale rather than swept-and-discarded: the sweep's whole effect
  // is the state write, so calling it and ignoring the result would perform the
  // mutation a read-only caller asked not to happen.
  if (!sweepArchives) return sessions;
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
  sweepArchives: boolean,
): Promise<SessionRow[]> {
  // See applyMergedPrAutoArchive: the sweep IS the write, so a read-only caller
  // must not reach it at all.
  if (!sweepArchives) return sessions;
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
type FamiliarWorkspaceRoots = {
  root: string;
  declaredRoots: string[];
};

async function loadFamiliarWorkspaceRoots(
  collapseFamiliarWorkspace: boolean,
  classifyFamiliarWorkspace: boolean,
): Promise<FamiliarWorkspaceRoots | null> {
  if (!collapseFamiliarWorkspace && !classifyFamiliarWorkspace) return null;
  return {
    root: familiarWorkspacesRoot(),
    declaredRoots: Array.from((await readFamiliarWorkspaces()).values()),
  };
}

/**
 * Apply the opt-in familiar-workspace view shaping to an already-scoped list.
 * Collapse changes membership; classification is metadata-only. Both consume
 * the same configured root snapshot so one compute path never re-reads
 * familiars.toml just to attach metadata after filtering.
 */
function applyFamiliarWorkspacePresentation(
  sessions: SessionRow[],
  familiarWorkspaceRoots: FamiliarWorkspaceRoots | null,
  collapseFamiliarWorkspace: boolean,
  classifyFamiliarWorkspace: boolean,
): SessionRow[] {
  if (!collapseFamiliarWorkspace && !classifyFamiliarWorkspace) return sessions;
  if (!familiarWorkspaceRoots) return sessions;
  const { root, declaredRoots } = familiarWorkspaceRoots;
  const visible = collapseFamiliarWorkspace
    ? collapseFamiliarWorkspaceSessions(sessions, root, declaredRoots)
    : sessions;
  return classifyFamiliarWorkspace
    ? classifyFamiliarWorkspaceSessions(visible, root, declaredRoots)
    : visible;
}

export async function computeSessionsList(
  includeArchived: boolean,
  familiarId: string | null,
  collapseFamiliarWorkspace: boolean,
  options: ComputeSessionsListOptions = {},
): Promise<SessionsListResult> {
  const sweepArchives = options.sweepArchives ?? DEFAULT_OPTIONS.sweepArchives;
  const enrichGit = options.enrichGit ?? DEFAULT_OPTIONS.enrichGit;
  const classifyFamiliarWorkspace =
    options.classifyFamiliarWorkspace ?? DEFAULT_OPTIONS.classifyFamiliarWorkspace;
  const withGitContext = async (rows: SessionRow[]): Promise<SessionRow[]> =>
    enrichGit ? enrichSessionsWithGitContext(rows) : rows;
  const [res, state, projects, familiarWorkspaceRoots] = await Promise.all([
    callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" }),
    loadState(),
    loadProjects(),
    loadFamiliarWorkspaceRoots(collapseFamiliarWorkspace, classifyFamiliarWorkspace),
  ]);
  const localConversations = (await listConversations()).map((conv) => {
    // Resolve every live chat against the in-process run registry so an
    // existing conversation's follow-up cannot retain stale attention while
    // generating. First-turn stubs (cave-0g2x) with no live run mean the server
    // died mid-turn: `failed`, not a phantom completion.
    // Registry-truth is process-local, which matches how chat runs live and
    // die with this server process.
    if (hasActiveChatRun(conv.sessionId)) return { ...conv, status: "running", exitCode: 0 };
    if (conv.pending) return { ...conv, status: "failed", exitCode: 1 };
    return conv;
  });
  // Backfill for local-only chat rows (UI chats the daemon never sees):
  // map the conversation's recorded cwd to its registered project root so
  // the sidebar's project groups pick new chats up immediately.
  const projectRootForCwd = (cwd: string) => projectForRoot(cwd, projects)?.root ?? null;
  if (!res.ok || !res.data) {
    const localSessions = await applyAutoArchiveSweep(
      localConversationSessionRows(localConversations, state, includeArchived, projectRootForCwd),
      state,
      includeArchived,
      sweepArchives,
    );
    if (localSessions.length > 0) {
      return {
        payload: {
          ok: true,
          degraded: true,
          error: res.error ?? `daemon http ${res.status}`,
          sessions: await applyMergedPrAutoArchive(
            await withGitContext(
              applyFamiliarWorkspacePresentation(
                await scopeForFamiliar(localSessions, projects, familiarId),
                familiarWorkspaceRoots,
                collapseFamiliarWorkspace,
                classifyFamiliarWorkspace,
              ),
            ),
            state,
            includeArchived,
            sweepArchives,
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

  // Leaked `coven run` registrations (the CLI died without reporting) sit in
  // "running" forever — the daemon only reconciles them at its own restart.
  // Present confirmed ghosts as "orphaned" before the merge so the Running
  // popover and status badges stop advertising dead processes. Read-only and
  // best-effort; genuinely-live daemon PTY sessions always carry events and
  // are never touched (see stale-running-sweep.ts).
  const staleRunningGhosts = await sweepStaleRunningGhosts(res.data);

  const sessions = await applyAutoArchiveSweep(
    mergeSessionRows({
      daemonSessions: applyStaleRunningPresentation(res.data, staleRunningGhosts),
      localConversations,
      state,
      includeArchived,
      isValidDaemonProjectRoot: isKnownProjectOrValidDir,
      projectRootForCwd,
    }).map((session) =>
      hasActiveChatRun(session.id)
        ? { ...session, status: "running", exit_code: 0, attention: NO_CHAT_ATTENTION }
        : session
    ),
    state,
    includeArchived,
    sweepArchives,
  );

  const scoped = await scopeForFamiliar(sessions, projects, familiarId);
  const visible = applyFamiliarWorkspacePresentation(
    scoped,
    familiarWorkspaceRoots,
    collapseFamiliarWorkspace,
    classifyFamiliarWorkspace,
  );
  return {
    payload: {
      ok: true,
      sessions: await applyMergedPrAutoArchive(
        await withGitContext(visible),
        state,
        includeArchived,
        sweepArchives,
      ),
    },
  };
}
