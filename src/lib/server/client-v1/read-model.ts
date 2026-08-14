// Canonical read projections for the `/api/client/v1` facade (cave-client-v1
// plan, Task 5). Everything in this module is pure/IO-adjacent projection
// logic shared by BOTH the legacy `/api/sessions/list` route and the new
// standalone-client routes — there is exactly one canonical merge, one grant
// filter, one degraded-mode fallback, and one cache, never a forked
// reimplementation.
//
// `computeCanonicalSessionList` below is a verbatim extraction of what used
// to be `computeSessionsList` in `src/app/api/sessions/list/route.ts`: same
// daemon call, same local-conversation merge, same auto-archive sweeps, same
// familiar/project grant scoping, same familiar-workspace collapse.
// `getCanonicalSessionList` wraps it in the shared `sessionsListCache` (see
// @/lib/server/sessions-list-cache), keyed by
// `(includeArchived, familiarId, collapseFamiliarWorkspace)`. The legacy
// route and every client-v1 list/detail/search orchestrator call THIS cached
// accessor — never `computeCanonicalSessionList` directly — so a poll
// through either surface can serve or revalidate the other's entry, and
// `invalidateSessionsListCache()` from a mutation busts both.

import fs from "node:fs";
import crypto from "node:crypto";

import { callDaemon } from "@/lib/coven-daemon";
import { loadConfig, loadState, type CaveState } from "@/lib/cave-config";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { catalogForRuntime } from "@/lib/runtime-models";
import {
  activeConversationTurns,
  listConversations,
  loadConversation,
  searchConversations,
  type ChatTurn,
  type ConversationFile,
  type ConversationSearchHit,
} from "@/lib/cave-conversations";
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
import { collapseFamiliarWorkspaceSessions } from "@/lib/familiar-workspace-sessions";
import { familiarWorkspacesRoot, readFamiliarWorkspaces } from "@/lib/coven-paths";
import { sessionsListCache, type SessionsListResult } from "@/lib/server/sessions-list-cache";
import { loadProjects, projectForRoot, projectsVisibilityGeneration, type CaveProject } from "@/lib/cave-projects";
import {
  filterFamiliarsForProject,
  filterProjectsForFamiliar,
  listAccessibleProjects,
  loadProjectPermissions,
  projectPermissionsVisibilityGeneration,
} from "@/lib/project-permissions";
import type { ProjectAccessLevel } from "@/lib/project-access-levels";
import { scopeSessionsToFamiliarProjects } from "@/lib/session-project-scope";
import {
  loadVisibleFamiliarRoster,
  type VisibleFamiliarRosterEntry,
  type VisibleFamiliarRosterResult,
} from "@/lib/server/familiar-roster";
import { validateCaveProjectRoot } from "@/lib/server/project-paths";
import { SLASH_COMMANDS, type SlashCommand } from "@/lib/slash-commands";
import type { SessionInitiator, SessionRow } from "@/lib/types";
import { sessionStatusTone } from "@/lib/session-status";

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

/**
 * The canonical session-list projection. Verbatim extraction of the former
 * `computeSessionsList` in `src/app/api/sessions/list/route.ts` (cave-client-v1
 * plan, Task 5, Step 1) — same daemon merge, same degraded-mode local
 * fallback, same familiar/project grant scoping and familiar-workspace
 * collapse.
 *
 * This is the raw, UNCACHED compute — no caller outside this module or its
 * own tests should call it directly. Both the legacy `/api/sessions/list`
 * route and every client-v1 read orchestrator go through
 * `getCanonicalSessionList` below instead, which wraps this exact function
 * in the shared `sessionsListCache` so there is exactly one canonical merge
 * AND exactly one cache entry per (includeArchived, familiarId,
 * collapseFamiliarWorkspace), never a forked reimplementation or a
 * forked cache.
 */
export async function computeCanonicalSessionList(
  includeArchived: boolean,
  familiarId: string | null,
  collapseFamiliarWorkspace: boolean,
): Promise<SessionsListResult> {
  const [res, state, projects] = await Promise.all([
    callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" }),
    loadState(),
    loadProjects(),
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

/**
 * Cache key for one canonical session-list view — a single source of truth
 * shared by `getCanonicalSessionList` below and the legacy `/api/sessions/list`
 * route, so both build the exact same key string for the exact same
 * (includeArchived, familiarId, collapseFamiliarWorkspace, visibilityGenerations)
 * inputs and can never accidentally alias or fragment the shared cache.
 *
 * `visibilityGenerations` folds in the cross-process cache-visibility nonces
 * (cave-client-v1 plan Task 5/7 followup — process-local
 * `sessionsListCache.clear()` alone cannot make ANOTHER process's
 * project-permission/group mutation or project-registry mutation visible to
 * THIS process): `[projectPermissionsVisibilityGeneration, projectsVisibilityGeneration]`,
 * read fresh by `getCanonicalSessionList` before every relevant cache lookup
 * (`readCanonicalSessionListVisibilityGenerations`). A revocation/registry
 * change committed by another process regenerates its store's nonce inside
 * the SAME durable write transaction as the mutation itself (never on a
 * failed write), so the very next read in THIS process — before it even
 * touches the cache — observes the new nonce, builds a DIFFERENT key, and
 * necessarily misses: no explicit cross-process invalidation signal is
 * needed, and no result can ever be served across a generation change.
 * Defaults to a fixed sentinel pair so every pre-existing call site (tests,
 * the legacy route before this change) that doesn't yet pass generations
 * keeps building a stable, non-colliding key for its own tuple.
 */
export function canonicalSessionListCacheKey(
  includeArchived: boolean,
  familiarId: string | null,
  collapseFamiliarWorkspace: boolean,
  visibilityGenerations: readonly [string, string] = ["", ""],
): string {
  // JSON-encode the full input tuple rather than string-templating the
  // unscoped (null) familiarId behind an "all" sentinel — a real familiar
  // literally named "all" (a valid id under isValidFamiliarId) would
  // otherwise alias the SAME key as the unscoped operator view, letting an
  // "all"-scoped list/detail/search request be served the fully unscoped
  // (every-familiar) payload straight out of cache: a permission leak.
  // JSON.stringify encodes `null` and the string `"all"` distinctly (`null`
  // vs `"all"`), and quotes/escapes every string field, so no valid familiar
  // id — including one containing what would otherwise be a delimiter — can
  // ever produce a key string equal to a different (includeArchived,
  // familiarId, collapseFamiliarWorkspace, visibilityGenerations) tuple's key.
  return JSON.stringify([
    includeArchived,
    familiarId,
    collapseFamiliarWorkspace,
    visibilityGenerations[0],
    visibilityGenerations[1],
  ]);
}

/**
 * Reads the two durable cross-process cache-visibility nonces
 * (`@/lib/project-permissions.ts`'s `projectPermissionsVisibilityGeneration`
 * and `@/lib/cave-projects.ts`'s `projectsVisibilityGeneration`) that
 * `canonicalSessionListCacheKey` folds into every canonical sessions-list
 * cache key. Read fresh on every call — never cached itself — so a
 * mutation committed by another process is observed here on the very next
 * call, before this process's own cache lookup runs.
 */
async function readCanonicalSessionListVisibilityGenerations(
  familiarId: string | null,
): Promise<[string, string]> {
  const [permissionsGeneration, projectsGeneration] = await Promise.all([
    familiarId ? projectPermissionsVisibilityGeneration() : Promise.resolve(""),
    projectsVisibilityGeneration(),
  ]);
  return [permissionsGeneration, projectsGeneration];
}

// Bounds the shared sessions-list cache's growth across generation changes
// (rather than letting a distinct key accumulate per generation forever).
// Permission generation is intentionally tracked only when a scoped read
// actually opened that store: switching between an unscoped operator read
// (which carries the empty sentinel) and a scoped familiar read must not
// itself look like a mutation and flush every warm cache entry.
let lastSeenProjectsVisibilityGeneration: string | null = null;
let lastSeenPermissionsVisibilityGeneration: string | null = null;

function clearSessionsListCacheOnGenerationChange(visibilityGenerations: readonly [string, string]): void {
  const [permissionsGeneration, projectsGeneration] = visibilityGenerations;
  const projectChanged =
    lastSeenProjectsVisibilityGeneration !== null
    && lastSeenProjectsVisibilityGeneration !== projectsGeneration;
  const permissionsChanged =
    permissionsGeneration !== ""
    && lastSeenPermissionsVisibilityGeneration !== null
    && lastSeenPermissionsVisibilityGeneration !== permissionsGeneration;
  if (projectChanged || permissionsChanged) {
    sessionsListCache.clear();
  }
  lastSeenProjectsVisibilityGeneration = projectsGeneration;
  if (permissionsGeneration !== "") {
    lastSeenPermissionsVisibilityGeneration = permissionsGeneration;
  }
}

/**
 * Cached accessor for the canonical session list — the ONE place both the
 * legacy `/api/sessions/list` route and every client-v1 read orchestrator
 * (`listClientConversations`, `getClientConversationDetail`,
 * `searchClientConversations`) go through to read canonical sessions. It
 * wraps `computeCanonicalSessionList` in the SAME shared `sessionsListCache`
 * singleton the legacy route used to own directly, keyed by the SAME
 * `(includeArchived, familiarId, collapseFamiliarWorkspace, visibilityGenerations)`
 * scheme (`canonicalSessionListCacheKey`) — so a poll through either surface
 * can serve or revalidate the other's entry, and `invalidateSessionsListCache()`
 * from any session mutation (conversation save/delete, archive/summon,
 * title, pin, kill, prune, ...) busts every one of them, since they are all
 * the same cache instance under the hood. Cross-process permission/registry
 * visibility is handled separately (see `canonicalSessionListCacheKey`'s doc
 * comment): each call reads the project generation fresh, and
 * familiar-scoped calls also read permission generation
 * (`readCanonicalSessionListVisibilityGenerations`), so a revocation another
 * process just committed selects a brand-new scoped key on this process's
 * very next call — never served the pre-revocation scoped view during the
 * cache's normal stale-serve window.
 *
 * Deliberately wraps ONLY the canonical merge, never a client-specific
 * projection (grant/ownership filtering, project-id narrowing, pagination,
 * client-safe shaping): those all run AFTER reading from this cache in each
 * caller, so caching never bakes one caller's narrowed view into a key other
 * callers share — familiar/archived/collapse isolation stays exact, driven
 * entirely by the canonical key.
 */
export async function getCanonicalSessionList(
  includeArchived: boolean,
  familiarId: string | null,
  collapseFamiliarWorkspace: boolean,
): Promise<SessionsListResult> {
  const visibilityGenerations = await readCanonicalSessionListVisibilityGenerations(familiarId);
  clearSessionsListCacheOnGenerationChange(visibilityGenerations);
  return sessionsListCache.get(
    canonicalSessionListCacheKey(includeArchived, familiarId, collapseFamiliarWorkspace, visibilityGenerations),
    () => computeCanonicalSessionList(includeArchived, familiarId, collapseFamiliarWorkspace),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stable client-safe conversation projection (Task 5, Step 3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Stable, wire-safe shape a standalone OpenCoven Chat client may receive for
 * a conversation. Deliberately NOT `SessionRow` or `ConversationSummary`:
 * those carry Cave-internal/operational fields (git context, daemon
 * initiator metadata, keep marks, workspace-collapse bookkeeping, etc.) that
 * either leak Cave's local filesystem/host details or are meaningless off
 * the loopback UI. Only the fields below ever cross the client-v1 boundary.
 */
export type ClientConversationSummary = {
  id: string;
  familiarId: string;
  title: string;
  preview: string;
  projectId: string | null;
  projectRoot: string | null;
  status: "idle" | "running" | "failed" | "attention";
  pinned: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: string;
  revisionTime: number;
};

/**
 * Raised when a canonical row cannot be projected into a
 * `ClientConversationSummary` — currently only an unparsable `updatedAt`.
 * Per the plan ("fail/omit rather than NaN JSON"), callers must never let a
 * `NaN`/invalid `revisionTime` reach the wire; they catch this and skip the
 * offending row (mirroring how `searchConversations`/`listConversations`
 * already skip corrupt individual records rather than failing the whole
 * response).
 */
export class UnprojectableSessionRowError extends Error {
  constructor(sessionId: string, reason: string) {
    super(`cannot project session ${sessionId} to a client conversation summary: ${reason}`);
    this.name = "UnprojectableSessionRowError";
  }
}

/**
 * Maps a canonical `SessionRow`'s status + attention onto the client's
 * closed status enum, using the SAME canonical tone bucketing every other
 * status-dot surface in the app uses (`sessionStatusTone`,
 * `src/lib/session-status.ts`) — never a re-derived/partial mapping of the
 * open daemon/local status string. `attention` (a human is explicitly
 * waiting on a response) takes priority over a merely-idle/done row so the
 * client can badge it, but never overrides a still-`running` row — a live
 * stream always reports `running`. `error`/`killed`/`orphaned` all collapse
 * to the canonical `failed` tone (spec-review finding #2); anything the
 * canonical mapping treats as `done` (or otherwise unclassified) falls
 * through to the client's `idle` default.
 */
function toClientStatus(row: SessionRow): ClientConversationSummary["status"] {
  const tone = sessionStatusTone(row.status);
  if (tone === "running") return "running";
  if (row.attention?.state === "awaiting-human") return "attention";
  if (tone === "failed") return "failed";
  return "idle";
}

/**
 * Safe default/empty preview used whenever no cheap, message-derived preview
 * is available (pure projection call sites with no loaded conversation
 * content). Never duplicates the row's own `title` — spec-review finding #3
 * requires preview to reflect actual message content, not a second copy of
 * the title, and an empty string is an explicit, intentional "no preview
 * yet" value rather than a stand-in derived from another field.
 */
function derivePreview(): string {
  return "";
}

function resolveProjectIdentity(
  row: SessionRow,
  projects: readonly { id: string; root: string }[],
): { projectId: string | null; projectRoot: string | null } {
  const root = row.project_root?.trim() || null;
  if (!root) return { projectId: null, projectRoot: null };
  const project = projectForRoot(root, projects as never);
  return { projectId: project?.id ?? null, projectRoot: root };
}

/**
 * Canonical, explicitly-ordered fields the revision digest is computed over.
 * Fixed key ORDER (not reliance on object insertion order, which is not a
 * cross-engine-stable contract for arbitrary code) so the same logical row
 * always serializes to the same bytes. Every field the client can observe
 * that identifies the row OR can change out from under it (rename, pin,
 * archive, status, project move) is included — not just "identity" fields —
 * because the revision doubles as an optimistic-concurrency token: a client
 * must be able to detect ANY visible mutation, not just a subset.
 */
function revisionInput(summary: Omit<ClientConversationSummary, "revision" | "revisionTime">): string {
  return JSON.stringify([
    summary.id,
    summary.familiarId,
    summary.title,
    summary.preview,
    summary.projectId,
    summary.projectRoot,
    summary.status,
    summary.pinned,
    summary.archivedAt,
    summary.createdAt,
    summary.updatedAt,
  ]);
}

/** Stable SHA-256 hex digest over `revisionInput`'s fixed serialization. */
function computeRevision(summary: Omit<ClientConversationSummary, "revision" | "revisionTime">): string {
  return crypto.createHash("sha256").update(revisionInput(summary)).digest("hex");
}

/**
 * Projects one canonical `SessionRow` into the stable client-v1 shape.
 * Throws `UnprojectableSessionRowError` when `updatedAt` does not parse to a
 * finite instant — the plan requires the response to fail/omit rather than
 * ever emit a `NaN` `revisionTime` as JSON (which silently serializes to
 * `null`, indistinguishable from a deliberate absence).
 *
 * `opts.preview`, when supplied, is a real message-derived preview computed
 * by a caller that has already loaded the conversation's content (see
 * `deriveMessagePreview` below) and is threaded through so the revision
 * digest is computed over the FINAL field values rather than a placeholder
 * later overwritten out-of-band. Pure call sites (no loaded conversation —
 * e.g. the list orchestrator's first, IO-free pagination pass) omit it and
 * get the safe `""` default from `derivePreview`.
 */
export function toClientConversationSummary(
  row: SessionRow,
  projects: readonly { id: string; root: string }[],
  opts?: { preview?: string },
): ClientConversationSummary {
  const revisionTime = Date.parse(row.updated_at);
  if (!Number.isFinite(revisionTime)) {
    throw new UnprojectableSessionRowError(row.id, `invalid updatedAt "${row.updated_at}"`);
  }
  const { projectId, projectRoot } = resolveProjectIdentity(row, projects);
  const base: Omit<ClientConversationSummary, "revision" | "revisionTime"> = {
    id: row.id,
    familiarId: row.familiarId ?? "",
    title: row.title,
    preview: opts?.preview ?? derivePreview(),
    projectId,
    projectRoot,
    status: toClientStatus(row),
    pinned: row.pinned === true,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return { ...base, revision: computeRevision(base), revisionTime };
}

// ─────────────────────────────────────────────────────────────────────────
// Cursor pagination (Task 5, Step 3)
// ─────────────────────────────────────────────────────────────────────────

export type ClientConversationCursor = { updatedAt: string; id: string };

/** Encodes the last `(updatedAt, id)` pair of a page as an opaque base64url token. */
export function encodeConversationCursor(cursor: ClientConversationCursor): string {
  return Buffer.from(JSON.stringify([cursor.updatedAt, cursor.id]), "utf8").toString("base64url");
}

/**
 * Strictly decodes a client-supplied cursor. Returns `null` for anything that
 * is not exactly a base64url-encoded 2-tuple of `[updatedAt: string, id:
 * string]` with a parseable `updatedAt` and a non-empty `id` — never throws,
 * so callers can treat "invalid cursor" as one uniform 400 case.
 */
export function decodeConversationCursor(raw: string): ClientConversationCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [updatedAt, id] = parsed;
  if (typeof updatedAt !== "string" || typeof id !== "string") return null;
  if (!Number.isFinite(Date.parse(updatedAt))) return null;
  if (!id) return null;
  // Round-trip check: a cursor is only ever valid if it is byte-identical to
  // one this same encoder would have produced — rejects any hand-crafted
  // token whose JSON happens to parse but was never actually issued in this
  // canonical shape (e.g. extra whitespace, a different array shape it
  // degrades into by coincidence).
  if (encodeConversationCursor({ updatedAt, id }) !== raw) return null;
  return { updatedAt, id };
}

/** Deterministic collection order: `updatedAt` descending, `id` ascending on ties. */
export function compareConversationSummaries(
  a: ClientConversationSummary,
  b: ClientConversationSummary,
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True when `summary` sorts strictly AFTER `cursor` in `compareConversationSummaries` order. */
function isAfterCursor(summary: ClientConversationSummary, cursor: ClientConversationCursor): boolean {
  if (summary.updatedAt !== cursor.updatedAt) return summary.updatedAt < cursor.updatedAt;
  return summary.id > cursor.id;
}

export const CLIENT_CONVERSATIONS_DEFAULT_LIMIT = 50;
export const CLIENT_CONVERSATIONS_MAX_LIMIT = 200;

export type ClientConversationPage = {
  items: ClientConversationSummary[];
  nextCursor: string | null;
};

/**
 * Sorts (deterministically), applies a decoded cursor, and bounds a list of
 * already-projected summaries to one page. Pure — no IO — so pagination
 * semantics (ordering, cursor boundary, page size) are testable independent
 * of the canonical merge/projection above.
 */
export function paginateConversationSummaries(
  summaries: readonly ClientConversationSummary[],
  opts: { cursor: ClientConversationCursor | null; limit: number },
): ClientConversationPage {
  const sorted = [...summaries].sort(compareConversationSummaries);
  const afterCursor = opts.cursor
    ? sorted.filter((summary) => isAfterCursor(summary, opts.cursor!))
    : sorted;
  const items = afterCursor.slice(0, opts.limit);
  const hasMore = afterCursor.length > opts.limit;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeConversationCursor({ updatedAt: last.updatedAt, id: last.id }) : null;
  return { items, nextCursor };
}

// ─────────────────────────────────────────────────────────────────────────
// Familiar ownership (Task 5 spec-review finding #1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Strict ownership check for the standalone client-v1 read surface: a
 * caller-supplied `familiarId` is never trusted as the source of ownership
 * on its own (that is what the caller is ASKING to see, not proof they own
 * it) — ownership is always derived from the row's OWN canonical
 * `familiarId` field, the same field `filterVisibleChatSessions`
 * (`@/lib/chat-projects.ts`) already uses as the established
 * direct-equality ownership pattern elsewhere in this codebase.
 *
 * `scopeSessionsToFamiliarProjects`/`computeCanonicalSessionList` only
 * enforce PROJECT grants: a rootless conversation (no `project_root`) or a
 * conversation in a project the caller's familiar happens to share access
 * to ALWAYS passes that filter regardless of who actually owns it. That is
 * correct for the Cave desktop UI (multiple familiars legitimately sharing
 * one project board) but wrong for the client-v1 standalone-chat facade,
 * where a caller must only ever see conversations belonging to ITS OWN
 * familiar. This helper is layered on top, in the client-v1-specific
 * orchestrators only, and never touches `computeCanonicalSessionList`
 * itself (shared verbatim with the legacy `/api/sessions/list` route).
 *
 * `familiarId === null` denotes the unscoped/operator view (no caller
 * familiar to check ownership against) and passes everything through,
 * matching every other null-familiar code path in this file.
 */
function ownedByFamiliar(row: Pick<SessionRow, "familiarId">, familiarId: string | null): boolean {
  if (familiarId === null) return true;
  return row.familiarId === familiarId;
}

// ─────────────────────────────────────────────────────────────────────────
// Message-content preview (Task 5 spec-review finding #3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Bound on the client-facing preview string. Chosen to be an order of
 * magnitude with `searchConversations`'s own snippet radius
 * (`SEARCH_SNIPPET_RADIUS = 40` chars each side of a match, ~80 total) while
 * being generous enough to read as a genuine last-message preview rather
 * than a fragment.
 */
const MESSAGE_PREVIEW_MAX_CHARS = 160;

/**
 * Collapses whitespace (newlines, repeated spaces/tabs from a multi-line
 * message) into a single-line, plain-text excerpt and truncates with an
 * ellipsis — mirrors `searchSnippet`'s existing sanitizer style
 * (`cave-conversations.ts`) so preview text is bounded, single-line, and
 * carries no raw formatting/control characters onto the wire.
 */
function boundedPlainTextPreview(text: string, maxChars: number = MESSAGE_PREVIEW_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars).trimEnd()}…`;
}

/**
 * The canonical ACTIVE branch of a conversation's turns, root-first — never
 * every stored branch. Delegates entirely to the exported, FAIL-CLOSED
 * `activeConversationTurns` (`@/lib/cave-conversations.ts` — the same
 * validated resolution the sessions-list attention/terminal-status
 * derivation uses), never the bare `resolveActivePath`
 * (`@/lib/conversation-tree.ts`) directly: `resolveActivePath` alone falls
 * back to a stable createdAt-ordered linearization of the WHOLE turn set
 * (every branch) on a missing/unresolvable leaf, which is exactly the
 * "never all turns" failure this facade must not hit (Task 5 spec-review:
 * active-path fail-closed). `activeConversationTurns` returns `[]` for both
 * a genuinely empty conversation and an invalid/ambiguous one — callers that
 * must tell those apart (never silently 200 with an empty page on invalid
 * metadata) check `conversation.turns.length > 0` themselves; see
 * `getClientConversationDetail` below.
 */
function activePathTurns(conversation: Pick<ConversationFile, "turns" | "activeLeafId">): ChatTurn[] {
  return activeConversationTurns(conversation);
}

/**
 * Derives the bounded, plain-text preview from the LAST turn of the active
 * path only — never the full unbounded turn set, and never raw/unsanitized
 * content. An empty conversation (no turns on its active path) gets the
 * safe empty default, per the spec's explicit allowance. This is plain
 * conversation content (the user's/familiar's own message text) — distinct
 * from internal system-prompt/harness-template material, which never lives
 * on a `ChatTurn` and so can never leak through this preview.
 */
function deriveMessagePreview(conversation: Pick<ConversationFile, "turns" | "activeLeafId">): string {
  const turns = activePathTurns(conversation);
  const last = turns[turns.length - 1];
  if (!last || typeof last.text !== "string" || !last.text.trim()) return "";
  return boundedPlainTextPreview(last.text);
}

// ─────────────────────────────────────────────────────────────────────────
// Conversation list / detail / search orchestration (Task 5, Step 3)
// ─────────────────────────────────────────────────────────────────────────

export type ListClientConversationsParams = {
  familiarId: string | null;
  /** A resolved, already-validated project id, or null for no project filter. */
  projectId: string | null;
  includeArchived: boolean;
  cursor: ClientConversationCursor | null;
  limit: number;
};

export type ListClientConversationsResult =
  | { ok: true; page: ClientConversationPage; degraded: boolean }
  | { ok: false; status: number; error: string };

/**
 * Orchestrates the conversation-list read: the canonical merge/grant scope
 * (`getCanonicalSessionList` — the SAME cached accessor, over the SAME
 * `sessionsListCache` singleton/key scheme, the legacy `/api/sessions/list`
 * route uses), an additional project-id narrowing (not present in the legacy
 * route, since only client-v1 exposes it), stable client-safe projection,
 * and cursor pagination. A row that fails to project (unparsable
 * `updatedAt`) is skipped rather than failing the whole page — matching
 * `listConversations`/`searchConversations`'s existing posture of skipping
 * individual corrupt records.
 *
 * `degraded` mirrors the canonical merge's own degraded flag (daemon
 * unreachable, local-only fallback in effect) but NEVER the canonical
 * payload's raw `error` text — that string can carry daemon stderr,
 * hostnames, or filesystem paths and must never cross the client-v1 wire
 * boundary. A standalone client only ever needs to know the result may be
 * partial, not why.
 */
export async function listClientConversations(
  params: ListClientConversationsParams,
): Promise<ListClientConversationsResult> {
  let canonical: SessionsListResult;
  try {
    canonical = await getCanonicalSessionList(params.includeArchived, params.familiarId, false);
  } catch {
    // An uncaught exception here (e.g. a raw fs error from `loadState`/
    // `loadConfig` when `state.json`/`config.json` is unreadable) must never
    // propagate past this boundary — it could otherwise carry a real
    // filesystem path/hostname/stack straight onto the wire, bypassing
    // `clientV1Error`'s own 5xx message-masking entirely. Fail closed with
    // the same generic shape a canonical `payload.ok === false` produces.
    return { ok: false, status: 503, error: "internal_error" };
  }
  if (!canonical.payload.ok) {
    return {
      ok: false,
      status: canonical.init?.status ?? 503,
      error: canonical.payload.error,
    };
  }
  const degraded = canonical.payload.degraded === true;
  const projects = await loadProjects();
  // Ownership FIRST (finding #1): a rootless or shared-project conversation
  // belonging to a different familiar must never reach the project-id
  // narrowing or the page below, regardless of the caller-supplied
  // `familiarId` query — ownership is only ever derived from the row's own
  // canonical `familiarId`, never trusted from the caller.
  let rows = canonical.payload.sessions.filter((row) => ownedByFamiliar(row, params.familiarId));
  if (params.projectId) {
    rows = rows.filter((row) => {
      const root = row.project_root?.trim();
      if (!root) return false;
      return projectForRoot(root, projects)?.id === params.projectId;
    });
  }
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const summaries: ClientConversationSummary[] = [];
  for (const row of rows) {
    try {
      summaries.push(toClientConversationSummary(row, projects));
    } catch {
      // Skip — never let one unprojectable row fail the whole page.
    }
  }
  const page = paginateConversationSummaries(summaries, { cursor: params.cursor, limit: params.limit });

  // Real message-derived previews (finding #3) require reading each
  // conversation's content, which is deliberately bounded to the PAGE
  // actually being returned (at most `params.limit`, itself capped at
  // `CLIENT_CONVERSATIONS_MAX_LIMIT`) — never the whole collection, so this
  // never becomes an unbounded N+1 disk read.
  const items = await Promise.all(
    page.items.map(async (summary) => {
      const row = rowsById.get(summary.id);
      if (!row) return summary;
      let conversation: ConversationFile | null;
      try {
        conversation = await loadConversation(summary.id);
      } catch {
        return summary;
      }
      if (!conversation) return summary;
      try {
        return toClientConversationSummary(row, projects, { preview: deriveMessagePreview(conversation) });
      } catch {
        return summary;
      }
    }),
  );

  return {
    ok: true,
    page: { items, nextCursor: page.nextCursor },
    degraded,
  };
}

/** A single durable, fetchable attachment reference — never a raw data URL or filesystem path. */
export type ClientConversationAttachment = {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

export type ClientConversationTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  attachments: ClientConversationAttachment[];
};

export type ClientConversationDetail = ClientConversationSummary & {
  turns: ClientConversationTurn[];
};

// ─────────────────────────────────────────────────────────────────────────
// Message pagination over a conversation's ACTIVE branch (Task 5 spec-review
// finding #4, hardened per a later spec-review pass: cursor stability across
// path shifts). Distinct from the conversation-LIST cursor above (which pages
// over `(updatedAt, id)` conversation summaries) — this pages over the
// LAST STABLE TURN ID a caller has already seen within one conversation's
// already branch-filtered, chronologically-ordered turn array.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A message cursor is the id of the last turn a caller has already
 * received — NEVER an array index. An index is only a snapshot of one
 * moment's active-path SHAPE: a later turn inserted earlier (an orphan
 * system echo `resolveActivePath` weaves in by `createdAt`, ahead of where
 * it first appeared) or a branch switch shifts every subsequent index, so a
 * stored index silently points at the wrong turn — or the right turn under
 * the wrong assumption — once the path changes underneath it. A turn id is
 * stable regardless of where it now sits in the (re-)resolved active path,
 * so decoding always LOCATES the id fresh in the CURRENT array rather than
 * trusting a remembered position (see `paginateConversationMessages`).
 *
 * No separate conversation-revision field is carried: turn ids are unique
 * within one conversation for the life of the transcript (turns are only
 * ever appended, never reassigned another turn's id), so "is this id still
 * on the active path" is already a complete, unambiguous staleness check —
 * an id that resolves is always the SAME turn the cursor was issued against.
 */
export type ClientConversationMessageCursor = { id: string };

/** Encodes a message-page boundary (the last-seen turn id) as an opaque base64url token. */
export function encodeMessageCursor(cursor: ClientConversationMessageCursor): string {
  return Buffer.from(JSON.stringify([cursor.id]), "utf8").toString("base64url");
}

// A generous, explicit bound on the raw encoded token — well above any real
// turn id (a UUID or similar short identifier) — so a client can never force
// this decoder to base64-decode/JSON-parse an unbounded attacker-supplied
// string before the shape checks below ever run.
const MESSAGE_CURSOR_MAX_RAW_LENGTH = 512;
const MESSAGE_CURSOR_MAX_ID_LENGTH = 256;

/**
 * Strictly decodes a client-supplied message cursor. Returns `null` for
 * anything that is not exactly a base64url-encoded, length-bounded 1-tuple
 * of `[id: non-empty, bounded string]` — never throws, so the route can
 * treat any malformed or tampered cursor as one uniform 400 case, same
 * posture as `decodeConversationCursor`.
 */
export function decodeMessageCursor(raw: string): ClientConversationMessageCursor | null {
  if (typeof raw !== "string" || !raw || raw.length > MESSAGE_CURSOR_MAX_RAW_LENGTH) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;
  const [id] = parsed;
  if (typeof id !== "string" || !id || id.length > MESSAGE_CURSOR_MAX_ID_LENGTH) return null;
  // Round-trip check, same rationale as `decodeConversationCursor`: only a
  // token byte-identical to one this encoder would have produced is valid —
  // rejects any hand-crafted/tampered token that happens to parse.
  if (encodeMessageCursor({ id }) !== raw) return null;
  return { id };
}

export const CLIENT_MESSAGES_DEFAULT_LIMIT = 50;
export const CLIENT_MESSAGES_MAX_LIMIT = 200;

export type ClientConversationMessagePage =
  | { ok: true; items: ClientConversationTurn[]; nextCursor: string | null }
  | { ok: false; reason: "stale_cursor" };

/**
 * Bounds an already-resolved ACTIVE-PATH turn array (root-first /
 * chronological — see `activePathTurns`) to one page, continuing forward
 * from a decoded cursor. Pure — no IO — so pagination semantics are
 * testable independent of conversation loading/branch resolution.
 *
 * Documented assumption (per the task's ambiguity note, no plan doc found):
 * pagination direction is oldest-first/forward, matching the active path's
 * own natural root-first order — consistent and simple rather than a guess
 * at a specific reverse-chronological UX.
 *
 * The cursor's turn id is LOCATED by scanning the CURRENT `turns` array —
 * never by trusting a remembered index — so a shift ahead of the cursor
 * (an inserted earlier turn) still resolves to the correct (new) position
 * and the page continues correctly. If the id is genuinely absent from the
 * current active path (the caller switched branches since the cursor was
 * issued, and that turn is no longer part of the selected path), pagination
 * fails CLOSED with an explicit `stale_cursor` result — never a silent empty
 * page and never a silently wrong/truncated one — so the route can 409
 * rather than returning something the caller could mistake for "no more
 * messages".
 */
export function paginateConversationMessages(
  turns: readonly ClientConversationTurn[],
  opts: { cursor: ClientConversationMessageCursor | null; limit: number },
): ClientConversationMessagePage {
  let startIndex = 0;
  if (opts.cursor) {
    const at = turns.findIndex((turn) => turn.id === opts.cursor!.id);
    if (at < 0) return { ok: false, reason: "stale_cursor" };
    startIndex = at + 1;
  }
  const items = turns.slice(startIndex, startIndex + opts.limit);
  const hasMore = startIndex + items.length < turns.length;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeMessageCursor({ id: last.id }) : null;
  return { ok: true, items, nextCursor };
}

/**
 * Assumption (documented per the task's ambiguity note): an attachment with
 * no persisted `storedId` has no durable, fetchable reference a standalone
 * client could ever retrieve (an in-memory `dataUrl` is stripped at
 * persistence per `saveConversation`'s contract), so it is dropped rather
 * than exposed as a dead/unusable stub.
 */
function toClientConversationAttachments(
  attachments: ChatTurn["attachments"],
): ClientConversationAttachment[] {
  if (!attachments) return [];
  const result: ClientConversationAttachment[] = [];
  for (const attachment of attachments) {
    if (!attachment.storedId) continue;
    result.push({
      id: attachment.storedId,
      name: attachment.name,
      mimeType: attachment.mimeType ?? attachment.type ?? null,
      sizeBytes: typeof attachment.size === "number" ? attachment.size : null,
    });
  }
  return result;
}

/**
 * Maps one persisted turn to the client-safe shape. Turn `text` IS exposed —
 * it is the user's/familiar's own conversation content, the entire point of
 * a conversation-detail read, and distinct from the "prompt contents" the
 * task's leak list refers to (internal system-prompt/harness-template
 * material, which never lives on `ChatTurn` in the first place). Everything
 * harness-internal (tool call raw input/output, reasoning traces, model
 * control state, harness session ids) is deliberately left off this shape.
 */
function toClientConversationTurn(turn: ChatTurn): ClientConversationTurn {
  return {
    id: turn.id,
    role: turn.role,
    text: turn.text,
    createdAt: turn.createdAt,
    attachments: toClientConversationAttachments(turn.attachments),
  };
}

export type GetClientConversationDetailResult =
  | {
      ok: true;
      detail: ClientConversationDetail;
      /** Bounded, paginated slice of `detail.turns` (the active branch only). */
      messages: ClientConversationTurn[];
      nextCursor: string | null;
      degraded: boolean;
    }
  | { ok: false; reason: "not_found"; degraded: boolean }
  | { ok: false; reason: "stale_cursor" }
  | { ok: false; reason: "internal_error" };

/**
 * Orchestrates the conversation-detail read. Visibility is computed from the
 * SAME canonical merge/grant scope as the list (`getCanonicalSessionList`,
 * the cached accessor over the shared `sessionsListCache`) — a conversation
 * outside the caller's familiar/project grants 404s exactly
 * like an unknown id, never leaking existence — PLUS a strict familiar
 * ownership check (`ownedByFamiliar`, spec-review finding #1): a conversation
 * belonging to a different familiar 404s exactly the same way, even if it is
 * rootless or lives in a project the caller's familiar happens to share.
 *
 * `detail.turns` is the FULL active-path array (finding #4: only the
 * canonical, FAIL-CLOSED active branch `activeConversationTurns` resolves —
 * see `activePathTurns` — never every stored branch) — retained on `detail`
 * for backward compatibility with Task 7 (`chat-service.ts` reads
 * `.detail.turns` directly for its own create/patch/delete echoes, and a
 * freshly created conversation's empty `turns: []` is asserted verbatim by
 * an existing POST test). `messages`/`nextCursor` are the NEW bounded,
 * cursor-paginated view (`paginateConversationMessages`) that the GET route
 * surfaces instead of the raw unbounded `turns` array. `loadConversation`
 * (never duplicated/reimplemented here) supplies the turn content; a
 * daemon-only session with no Cave transcript (e.g. a generator run) 404s —
 * it is not a renderable conversation.
 *
 * Active-path fail-closed (later spec-review pass): a conversation with
 * turns whose branch/leaf metadata is invalid (duplicate ids), ambiguous
 * (no leaf recorded and more than one resolvable candidate), or names a
 * missing/unresolvable turn resolves to `[]` from `activePathTurns` even
 * though `conversation.turns` is non-empty. That specific combination —
 * turns exist, but none of them resolve to a provably single active path —
 * is treated as `internal_error`, never a 200 with an empty
 * `messages`/`turns` a caller could mistake for a genuinely empty
 * conversation.
 *
 * `degraded` mirrors the canonical merge's degraded flag (daemon unreachable,
 * local-only fallback), never the raw `error` text. It is carried on BOTH the
 * success path and the `not_found` path: under a degraded merge, a 404 here
 * may mean "unknown" or may mean "this session is daemon-only and the local
 * fallback can't see it" — the caller can't tell those apart from a plain
 * 404, so the degraded signal is attached to make that ambiguity visible
 * without leaking any internal detail about why.
 */
export async function getClientConversationDetail(
  sessionId: string,
  opts: { familiarId: string | null; cursor?: ClientConversationMessageCursor | null; limit?: number },
): Promise<GetClientConversationDetailResult> {
  let canonical: SessionsListResult;
  try {
    canonical = await getCanonicalSessionList(true, opts.familiarId, false);
  } catch {
    return { ok: false, reason: "internal_error" };
  }
  if (!canonical.payload.ok) return { ok: false, reason: "internal_error" };
  const degraded = canonical.payload.degraded === true;

  const canonicalRow = canonical.payload.sessions.find((row) => row.id === sessionId);
  if (!canonicalRow) return { ok: false, reason: "not_found", degraded };
  // Ownership (finding #1): never distinguished from "unknown" so existence
  // is never leaked to a caller who isn't this conversation's own familiar.
  if (!ownedByFamiliar(canonicalRow, opts.familiarId)) return { ok: false, reason: "not_found", degraded };

  const projects = await loadProjects();

  let conversation: ConversationFile | null;
  try {
    conversation = await loadConversation(sessionId);
  } catch {
    return { ok: false, reason: "internal_error" };
  }
  if (!conversation) return { ok: false, reason: "not_found", degraded };

  let summary: ClientConversationSummary;
  try {
    summary = toClientConversationSummary(canonicalRow, projects, {
      preview: deriveMessagePreview(conversation),
    });
  } catch {
    return { ok: false, reason: "internal_error" };
  }

  // Active branch only (finding #4), FAIL CLOSED (active-path fail-closed):
  // non-empty stored turns that fail to resolve to one provable active path
  // must never present as an empty (or worse, unfiltered) conversation.
  const resolvedTurns = activePathTurns(conversation);
  if (conversation.turns.length > 0 && resolvedTurns.length === 0) {
    return { ok: false, reason: "internal_error" };
  }
  const activeTurns = resolvedTurns.map(toClientConversationTurn);
  const limit = Math.min(Math.max(1, opts.limit ?? CLIENT_MESSAGES_DEFAULT_LIMIT), CLIENT_MESSAGES_MAX_LIMIT);
  const messagePage = paginateConversationMessages(activeTurns, { cursor: opts.cursor ?? null, limit });
  if (!messagePage.ok) return { ok: false, reason: "stale_cursor" };

  return {
    ok: true,
    detail: { ...summary, turns: activeTurns },
    messages: messagePage.items,
    nextCursor: messagePage.nextCursor,
    degraded,
  };
}

export type SearchClientConversationsResult =
  | { ok: true; hits: ClientConversationSearchHit[]; degraded: boolean }
  | { ok: false; reason: "internal_error" };

/** Stable, explicit client-v1 search-hit shape — never the internal `ConversationSearchHit` verbatim. */
export type ClientConversationSearchHit = {
  sessionId: string;
  title: string | null;
  snippet: string;
  matchCount: number;
};

function toClientConversationSearchHit(hit: ConversationSearchHit): ClientConversationSearchHit {
  return {
    sessionId: hit.sessionId,
    title: hit.title ?? null,
    snippet: hit.snippet,
    matchCount: hit.matchCount,
  };
}

/**
 * Orchestrates conversation search: calls `searchConversations` (never
 * reimplemented), supplying a `filter` callback (search
 * authorization-before-limit) that checks the SAME canonical visibility set
 * the list uses — PLUS a strict familiar-ownership filter (`ownedByFamiliar`,
 * spec-review finding #1) — so neither an out-of-grant nor an
 * out-of-ownership conversation's content can ever surface through search.
 * Because `searchConversations` evaluates this `filter` on every matching
 * candidate BEFORE its own result set is capped to `limit` (canonical
 * authorization-before-limit contract — see `searchConversations`'s doc
 * comment in `cave-conversations.ts`), this orchestrator asks for exactly
 * `opts.limit` results directly: no client-side overfetch proxy is needed
 * (nor any overfetch multiplier/ceiling) since an inaccessible, however
 * recently-updated, candidate can never consume a result slot or crowd out
 * an accessible one — it is rejected by `filter` before it ever reaches the
 * ranked/limited result set.
 *
 * `degraded` mirrors the canonical merge's degraded flag, never its raw
 * `error` text: hits are always filtered to the local-fallback visibility
 * set when the daemon is unreachable, so a caller needs to know the result
 * may be missing daemon-only conversations, never the internal reason why.
 */
export async function searchClientConversations(
  query: string,
  opts: { familiarId: string | null; limit: number },
): Promise<SearchClientConversationsResult> {
  let canonical: SessionsListResult;
  try {
    canonical = await getCanonicalSessionList(true, opts.familiarId, false);
  } catch {
    return { ok: false, reason: "internal_error" };
  }
  if (!canonical.payload.ok) return { ok: false, reason: "internal_error" };
  const degraded = canonical.payload.degraded === true;
  const visible = new Set(
    canonical.payload.sessions.filter((row) => ownedByFamiliar(row, opts.familiarId)).map((row) => row.id),
  );

  let hits: ConversationSearchHit[];
  try {
    hits = await searchConversations(query, {
      limit: opts.limit,
      filter: (candidate) => visible.has(candidate.sessionId),
      // Task5 quality finding — a standalone client only ever shows the
      // active branch of a conversation, so search must never surface a hit
      // (or a snippet/count) that lives only on an inactive/abandoned
      // branch the client's own UI cannot render.
      activePathOnly: true,
    });
  } catch {
    return { ok: false, reason: "internal_error" };
  }
  return { ok: true, hits: hits.map(toClientConversationSearchHit), degraded };
}


// ─────────────────────────────────────────────────────────────────────────
// Familiar roster projection (Task 5, Step 3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Stable, wire-safe familiar shape. Deliberately NOT `VisibleFamiliarRosterEntry`
 * verbatim nor the richer `/api/familiars` enrichment (harness/model
 * overrides, voice/image provider config, Asana/X integration flags, avatar
 * URLs derived from on-disk files): none of that is needed to pick a
 * familiar and start/continue a standalone chat, and several of those fields
 * describe Cave-local integration/config surfaces this facade must not leak.
 */
export type ClientFamiliar = {
  id: string;
  displayName: string;
  role: string;
  description: string | null;
  pronouns: string | null;
  status: string | null;
  emoji: string | null;
};

export function toClientFamiliar(entry: VisibleFamiliarRosterEntry): ClientFamiliar {
  return {
    id: entry.id,
    displayName: entry.display_name,
    role: entry.role,
    description: entry.description ?? null,
    pronouns: entry.pronouns ?? null,
    status: entry.status ?? null,
    emoji: entry.emoji ?? null,
  };
}

export type ListClientFamiliarsResult =
  | { ok: true; familiars: ClientFamiliar[] }
  | { ok: false; status: number; error: string };

/**
 * Orchestrates the familiar-roster read: `loadVisibleFamiliarRoster` for the
 * canonical roster, optionally narrowed to one project's grants via
 * `filterFamiliarsForProject` — the SAME session-launch grant rule
 * `/api/familiars`'s own `projectId` filter uses, reused rather than
 * reimplemented.
 */
export async function listClientFamiliars(opts: { projectId: string | null }): Promise<ListClientFamiliarsResult> {
  let rosterResult: VisibleFamiliarRosterResult;
  try {
    rosterResult = await loadVisibleFamiliarRoster();
  } catch {
    // Same rationale as `listClientConversations`: `loadVisibleFamiliarRoster`
    // calls `loadConfig()` directly, which can throw a raw fs error (e.g. a
    // path-bearing `EISDIR`/`EACCES`) that must never cross this boundary
    // uncaught — fail closed with the same generic shape a roster-level
    // `ok: false` already produces.
    return { ok: false, status: 503, error: "internal_error" };
  }
  if (!rosterResult.ok) {
    return { ok: false, status: rosterResult.status, error: rosterResult.error };
  }
  let roster = rosterResult.roster;
  if (opts.projectId) {
    const permissions = await loadProjectPermissions();
    roster = filterFamiliarsForProject(permissions, roster, opts.projectId, "session-launch");
  }
  return { ok: true, familiars: roster.map(toClientFamiliar) };
}

// ─────────────────────────────────────────────────────────────────────────
// Project roster projection (Task 5, Step 3)
// ─────────────────────────────────────────────────────────────────────────

const CLIENT_PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Shape-only validation (never an existence check) for a client-supplied `projectId` query value. */
export function isValidClientProjectId(value: string): boolean {
  return CLIENT_PROJECT_ID_RE.test(value);
}

/**
 * Stable, wire-safe project shape. `root` is the project's local filesystem
 * path — deliberately included (not "filesystem-only config" in the sense
 * the task's leak list means): it is the same product-level data
 * `/api/projects` and `ClientConversationSummary.projectRoot` already expose,
 * needed so a client can show which local project a chat belongs to.
 */
export type ClientProject = {
  id: string;
  name: string;
  root: string;
  access: ProjectAccessLevel | null;
  repoUrl: string | null;
};

export function toClientProject(project: CaveProject, access: ProjectAccessLevel | null): ClientProject {
  return {
    id: project.id,
    name: project.name,
    root: project.root,
    access,
    repoUrl: project.repoUrl ?? null,
  };
}

/**
 * Orchestrates the project-roster read: `loadProjects` for the registry,
 * `listAccessibleProjects` to resolve a familiar's effective per-project
 * access level, then `validateCaveProjectRoot(project.root).ok` to drop
 * accessible-but-non-launchable roots (missing/non-directory on this host) —
 * the SAME functions, in the SAME order, `/api/projects`'s own `familiarId`
 * filter uses, so client-v1 can never expose a familiar-scoped project the
 * canonical route hides. No `familiarId` is the unscoped operator view
 * (every registered project, `access: null`, no launchability filter),
 * matching `/api/projects`'s contract exactly.
 */
export async function listClientProjects(opts: { familiarId: string | null }): Promise<ClientProject[]> {
  const projects = await loadProjects();
  if (!opts.familiarId) {
    return projects.map((project) => toClientProject(project, null));
  }
  const accessible = await listAccessibleProjects(projects, opts.familiarId);
  return accessible.flatMap(({ project, access }) =>
    validateCaveProjectRoot(project.root).ok ? [toClientProject(project, access)] : [],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Slash-command projection (Task 5, Step 3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Explicit ALLOWLIST (never a blocklist) of `src/lib/slash-commands.ts`
 * registry entries a standalone chat client may submit as ordinary chat
 * text. Fail-safe by construction: a future command added to the registry is
 * excluded here by default until someone deliberately reviews and adds it,
 * rather than silently leaking through an exclusion list that can go stale.
 *
 * Excluded, and why (documented per the task's ambiguity note — none of this
 * is codified anywhere else):
 *   - `/palette`, `/shortcuts` — open a Cave DESKTOP UI overlay (⌘K sheet,
 *     shortcuts sheet); there is no equivalent surface in a standalone client.
 *   - `/save` — writes into Cave's local "Research desk" surface, which a
 *     standalone chat client does not have.
 *   - the entire "familiar" section (`/familiar`) — opens Cave's familiar
 *     picker UI; a standalone client has its own native familiar switcher.
 *   - the entire "daemon" section (`/doctor`, `/daemon`) — runs local
 *     `coven doctor`/`coven daemon status` processes on the Cave host; a
 *     local-process-introspection command a remote client must never trigger.
 *   - the entire "view" section (`/sessions`, `/attach`, `/tui`, `/journal`,
 *     `/canvas`, `/board`, `/chats`, `/rituals`, `/remind`, `/projects`,
 *     `/toggle-agent`) — Cave desktop UI navigation surfaces (kanban, canvas,
 *     rituals calendar, etc.) with no standalone-client equivalent.
 *   - the entire "launch" section (`/run`, `/codex`, `/claude`) — launches a
 *     specific local runtime directly against the current project, bypassing
 *     the familiar/model selection and project-grant path a standalone
 *     client's message-send already goes through.
 */
const CLIENT_SAFE_SLASH_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "/help",
  "/clear",
  "/quit",
  "/new",
  "/model",
  "/skill",
  "/skills",
  "/prompt",
  "/prompts",
  "/image",
  "/auto",
]);

export type ClientSlashCommand = {
  name: string;
  aliases: string[];
  hint: string;
  description: string;
  argPlaceholder: string | null;
};

function toClientSlashCommand(command: SlashCommand): ClientSlashCommand {
  return {
    name: command.name,
    aliases: [...(command.aliases ?? [])],
    hint: command.hint,
    description: command.description,
    argPlaceholder: command.argPlaceholder ?? null,
  };
}

/**
 * Slash-command names whose usefulness depends on the runtime actually
 * advertising a matching capability, not merely on the standalone-safe
 * allowlist above. `/model` is meaningless (and would only invite a rejected
 * PATCH) against a harness Cave has no known model catalog for.
 */
const RUNTIME_CAPABILITY_GATED_COMMAND_NAMES: ReadonlySet<string> = new Set(["/model"]);

export type ClientSlashCommandCapabilityDependencies = {
  /**
   * Resolves the harness whose model catalog gates `/model`'s advertisement.
   * Defaults to Cave's own configured default harness (`config.defaults.harness`)
   * — the same harness a fresh chat launches with absent any familiar/session
   * override. Injectable so tests can simulate an unset/unknown harness
   * (capability absent) or a resolution failure (capability degraded)
   * without touching the real on-disk config.
   */
  resolveDefaultHarness?: () => Promise<string | null>;
};

async function defaultHarnessFromConfig(): Promise<string | null> {
  const config = await loadConfig();
  return config.defaults.harness ?? null;
}

/**
 * Whether the runtime `/model` would act against actually advertises a model
 * catalog (a curated menu, or an explicit "type any id" allowance) — the SAME
 * static, deterministic registry `/api/chat/model-state` and
 * `src/lib/slash-model.ts` already resolve model menus/validation from
 * (`catalogForRuntime` in `@/lib/runtime-models.ts`), never a duplicated
 * capability table. Reads no tokens, binary paths, or other local config into
 * the result — only a boolean. Any resolution failure (corrupt config,
 * missing state, etc.) fails CLOSED: the capability is treated as absent
 * rather than risking a stale/incorrect "available".
 */
async function runtimeModelCapabilityAvailable(
  deps: ClientSlashCommandCapabilityDependencies,
): Promise<boolean> {
  try {
    const harness = await (deps.resolveDefaultHarness ?? defaultHarnessFromConfig)();
    if (!harness) return false;
    const catalog = catalogForRuntime(canonicalHarnessId(harness));
    if (!catalog) return false;
    return catalog.allowCustom || catalog.models.length > 0;
  } catch {
    return false;
  }
}

/**
 * The deterministic, standalone-chat-safe slash-command catalog: the
 * `SLASH_COMMANDS` registry (never duplicated), filtered to the explicit
 * allowlist above AND — for commands the plan requires be gated on advertised
 * harness/model capability (currently only `/model`) — intersected with a
 * live capability check, mapped to the stable client shape, in the
 * registry's own declared order. A capability-check failure removes the
 * gated command rather than surfacing an error, so the deterministic-shape
 * contract (`{ ok: true, commands: [...] }`) holds even when Cave's own
 * config/state is unreadable.
 */
export async function computeClientSlashCommands(
  deps: ClientSlashCommandCapabilityDependencies = {},
): Promise<ClientSlashCommand[]> {
  const modelCapable = await runtimeModelCapabilityAvailable(deps);
  return SLASH_COMMANDS.filter((command) => {
    if (!CLIENT_SAFE_SLASH_COMMAND_NAMES.has(command.name)) return false;
    if (RUNTIME_CAPABILITY_GATED_COMMAND_NAMES.has(command.name) && !modelCapable) return false;
    return true;
  }).map(toClientSlashCommand);
}
