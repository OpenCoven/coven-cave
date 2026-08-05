import type { CaveState } from "./cave-config.ts";
import {
  defaultChatTitleForSession,
  sanitizeSessionTitle,
} from "./cave-chat-titles.ts";
import {
  conversationReplaySessions,
  type ConversationReplaySession,
} from "./cave-conversations.ts";
import {
  deriveChatAttention,
  NO_CHAT_ATTENTION,
  normalizeChatAttentionOperationId,
  normalizeChatAttentionOperationLineage,
  type ChatAttentionEvidence,
} from "./chat-attention.ts";
import { ACTIVE_SESSION_STATUSES } from "./chat-auto-archive.ts";
import { initiatorFromSessionKey } from "./session-initiator.ts";
import { inferOrigin } from "./session-origin.ts";
import type { SessionInitiator, SessionOrigin, SessionRow } from "./types.ts";

export type DaemonSessionRow = Omit<
  SessionRow,
  "attention" | "attentionAfterOperationId" | "attentionOperationLineage" | "familiarId" | "origin"
> & {
  conversation_id?: string | null;
};

export type LocalConversationSummary = {
  sessionId: string;
  harnessSessionId?: string;
  familiarId: string;
  harness?: string;
  model?: string;
  runtime?: string;
  title?: string;
  status?: string;
  exitCode?: number | null;
  createdAt?: string;
  updatedAt: string;
  initiator?: SessionInitiator;
  origin?: SessionOrigin;
  /** Work-branch snapshot recorded from the chat's cwd at its last turn. */
  branch?: string;
  /** PR URL the chat reported in an assistant reply (transcript snapshot). */
  prUrl?: string;
  attentionEvidence?: ChatAttentionEvidence;
  replaySessions?: ConversationReplaySession[];
};

type MergeOptions = {
  daemonSessions: DaemonSessionRow[];
  localConversations: LocalConversationSummary[];
  state: CaveState;
  includeArchived: boolean;
  isValidDaemonProjectRoot?: (projectRoot: string) => boolean;
  /** Map a local conversation's recorded cwd to a registered project root
   *  (null = no registered project). See localConversationToSession. */
  projectRootForCwd?: (cwd: string) => string | null;
};

const DAEMON_AUTHORITATIVE_TERMINAL_STATUSES = new Set(["archived", "killed", "orphaned", "stopped"]);

function isDaemonAuthoritativeTerminalStatus(status: string): boolean {
  return DAEMON_AUTHORITATIVE_TERMINAL_STATUSES.has(status);
}

// A project-root mismatch means the daemon can no longer vouch for a
// session's cwd/branch identity, but its status is still daemon-authoritative
// truth. Recovery previously handled only the terminal statuses above, so an
// invalid-root daemon session that is still actively running (or otherwise
// still doing work) was never marked `seen` — the local conversation then
// fell through to the local-only path and derived attention from its own
// ("completed") status, surfacing stale attention for a session the daemon
// says is still running. Recover active statuses too so `deriveChatAttention`
// sees the daemon-truth status and suppresses attention via
// ACTIVE_SESSION_STATUSES, same as it already does for a valid-root row.
function isDaemonRecoverableStatus(status: string): boolean {
  return isDaemonAuthoritativeTerminalStatus(status) || ACTIVE_SESSION_STATUSES.has(status);
}

function isArchivedStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "archived";
}

/** Extract the local cwd from a conversation runtime ("local:<cwd>").
 *  Kept dependency-free here (rather than importing the server work-branch
 *  helper) so this module stays pure and unit-testable. */
function conversationLocalCwd(runtime: string | undefined): string | null {
  if (!runtime?.startsWith("local:")) return null;
  const cwd = runtime.slice("local:".length).trim();
  return cwd || null;
}

function attentionAfterOperationId(
  evidence: ChatAttentionEvidence | null | undefined,
): string | null {
  return normalizeChatAttentionOperationId(evidence?.attentionAfterOperationId);
}

function attentionOperationLineageFields(
  evidence: ChatAttentionEvidence | null | undefined,
): { attentionOperationLineage: string[] } | Record<string, never> {
  const lineage = normalizeChatAttentionOperationLineage(evidence?.attentionOperationLineage);
  return lineage.length > 0 ? { attentionOperationLineage: lineage } : {};
}

function isDaemonAuthoritativeActiveStatus(status: string): boolean {
  return ACTIVE_SESSION_STATUSES.has(status);
}

function isDaemonAuthoritativeStatus(status: string): boolean {
  return isDaemonAuthoritativeTerminalStatus(status) || isDaemonAuthoritativeActiveStatus(status);
}

function localConversationToSession(
  conv: LocalConversationSummary,
  state: CaveState,
  projectRootForCwd?: (cwd: string) => string | null,
  now = Date.now(),
): SessionRow {
  const keep = Boolean(state.sessionKeep?.[conv.sessionId]);
  const pinned = Boolean(state.sessionPinned?.[conv.sessionId]);
  const extendedUntil = state.sessionArchiveExtendedUntil?.[conv.sessionId] ?? null;
  const title =
    state.sessionTitles[conv.sessionId] ?? sanitizeSessionTitle(conv.title) ?? "Chat";
  const familiarId = state.sessionFamiliar[conv.sessionId] ?? conv.familiarId ?? null;
  const status = conv.status ?? "completed";
  const archivedAt = state.sessionArchived[conv.sessionId] ?? null;
  // Sidebar/rail project groups key on project_root. A UI chat only exists as
  // a local conversation (the daemon never sees it), so without this backfill
  // every new chat lands in the "No project" bucket instead of its project's
  // folder. Only registered-project cwds map — a chat running in the
  // familiar's own workspace (or any unregistered dir) stays No-project by
  // design (see resolveChatProjectSelection in chat-projects.ts).
  const cwd = conversationLocalCwd(conv.runtime);
  const projectRoot = (cwd ? projectRootForCwd?.(cwd) : null) ?? "";
  return {
    id: conv.sessionId,
    project_root: projectRoot,
    harness: conv.harness ?? "chat",
    ...(conv.model ? { model: conv.model } : {}),
    ...(conv.runtime ? { runtime: conv.runtime } : {}),
    title,
    status,
    exit_code: conv.exitCode ?? (status === "failed" || status === "error" ? 1 : 0),
    archived_at: archivedAt,
    created_at: conv.createdAt ?? conv.updatedAt,
    updated_at: conv.updatedAt,
    attention: deriveChatAttention({
      evidence: conv.attentionEvidence,
      status,
      archivedAt,
      now,
    }),
    attentionAfterOperationId: attentionAfterOperationId(conv.attentionEvidence),
    ...attentionOperationLineageFields(conv.attentionEvidence),
    familiarId,
    origin: conv.origin ?? "chat",
    hasLocalConversation: true,
    ...(conv.branch ? { workBranch: conv.branch } : {}),
    ...(conv.prUrl ? { chatPrUrl: conv.prUrl } : {}),
    initiator: conv.initiator ?? { kind: "human", label: "Cave user", channel: "cave" },
    ...(keep ? { keep: true } : {}),
    ...(pinned ? { pinned: true } : {}),
    ...(extendedUntil ? { archive_extended_until: extendedUntil } : {}),
  };
}

function linkedReplayTitle(
  local: LocalConversationSummary,
  replay: ConversationReplaySession,
  ordinal: number,
): string {
  const base =
    replay.title
    ?? sanitizeSessionTitle(local.title)
    ?? defaultChatTitleForSession(local.sessionId);
  return `${base} · Replay ${ordinal}`;
}

function visibleSession(row: SessionRow, state: CaveState, includeArchived: boolean): boolean {
  if (state.sessionSacrificed[row.id]) return false;
  return includeArchived || !row.archived_at;
}

export function localConversationSessionRows(
  localConversations: LocalConversationSummary[],
  state: CaveState,
  includeArchived: boolean,
  projectRootForCwd?: (cwd: string) => string | null,
): SessionRow[] {
  const now = Date.now();
  return localConversations
    .map((conv) => localConversationToSession(conv, state, projectRootForCwd, now))
    .filter((row) => visibleSession(row, state, includeArchived))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function mergeSessionRows({
  daemonSessions,
  localConversations,
  state,
  includeArchived,
  isValidDaemonProjectRoot,
  projectRootForCwd,
}: MergeOptions): SessionRow[] {
  const now = Date.now();
  const seen = new Set<string>();
  const rows: SessionRow[] = [];

  // The daemon bumps a session's `updated_at` when it's resumed/attached — i.e.
  // when you merely *open* a chat — so ordering by it sinks to "last viewed".
  // For UI-originated chats we also keep a local conversation whose `updatedAt`
  // is written only when a turn is appended (chat/send), so it tracks the last
  // message sent or received. Prefer that message-authoritative timestamp so
  // the list orders by real activity, not by what you last looked at.
  const localUpdatedById = new Map<string, string>();
  const localById = new Map<string, LocalConversationSummary>();
  const localByHarnessSessionId = new Map<string, LocalConversationSummary>();
  const localByReplaySessionId = new Map<string, { local: LocalConversationSummary; replayIndex: number }>();
  const localByReplayConversationId = new Map<string, { local: LocalConversationSummary; replayIndex: number }>();
  for (const conv of localConversations) {
    if (conv.updatedAt) {
      localUpdatedById.set(conv.sessionId, conv.updatedAt);
      localById.set(conv.sessionId, conv);
    }
    if (conv.harnessSessionId) {
      localByHarnessSessionId.set(conv.harnessSessionId, conv);
    }
    for (const [replayIndex, replay] of conversationReplaySessions(conv).entries()) {
      localByReplaySessionId.set(replay.sessionId, { local: conv, replayIndex });
      if (replay.conversationId) {
        localByReplayConversationId.set(replay.conversationId, { local: conv, replayIndex });
      }
    }
  }

  type MappedDaemonSession = {
    session: DaemonSessionRow;
    local: LocalConversationSummary | undefined;
    stateSessionId: string;
    harnessMatched: boolean;
    replayMatched: boolean;
    replayIndex: number | null;
  };
  const daemonByMappedId = new Map<string, MappedDaemonSession>();
  for (const session of daemonSessions) {
    const directLocal = localById.get(session.id);
    const harnessLocal = directLocal ? undefined : localByHarnessSessionId.get(session.id);
    const replayMatch = directLocal || harnessLocal
      ? undefined
      : localByReplaySessionId.get(session.id)
        ?? (session.conversation_id ? localByReplayConversationId.get(session.conversation_id) : undefined);
    const local = directLocal ?? harnessLocal ?? replayMatch?.local;
    const stateSessionId = local?.sessionId ?? session.id;
    const candidate = {
      session,
      local,
      stateSessionId,
      harnessMatched: Boolean(harnessLocal),
      replayMatched: Boolean(replayMatch),
      replayIndex: replayMatch?.replayIndex ?? null,
    };
    const existing = daemonByMappedId.get(stateSessionId);
    const candidateScore = candidate.harnessMatched ? 3 : candidate.replayMatched ? 2 : 1;
    const existingScore = existing ? (existing.harnessMatched ? 3 : existing.replayMatched ? 2 : 1) : 0;
    if (
      !existing
      || candidateScore > existingScore
      || (candidateScore === existingScore && session.updated_at > existing.session.updated_at)
      || (
        candidateScore === existingScore
        && candidate.replayMatched
        && existing.replayMatched
        && (candidate.replayIndex ?? -1) > (existing.replayIndex ?? -1)
      )
    ) {
      daemonByMappedId.set(stateSessionId, candidate);
    }
  }
  const primaryDaemonSessionIdByLocalId = new Map<string, string>();
  for (const mapped of daemonByMappedId.values()) {
    if (mapped.local) primaryDaemonSessionIdByLocalId.set(mapped.stateSessionId, mapped.session.id);
  }

  for (const { session, local, stateSessionId } of daemonByMappedId.values()) {
    if (isValidDaemonProjectRoot && !isValidDaemonProjectRoot(session.project_root)) {
      if (local && isDaemonRecoverableStatus(session.status)) {
        seen.add(stateSessionId);
        const recovered = localConversationToSession(local, state, projectRootForCwd, now);
        const archived_at = state.sessionArchived[stateSessionId] ?? session.archived_at;
        const attention =
          isArchivedStatus(session.status)
            ? NO_CHAT_ATTENTION
            : deriveChatAttention({
                evidence: local.attentionEvidence,
                status: session.status,
                archivedAt: archived_at,
                now,
              });
        const row: SessionRow = {
          ...recovered,
          daemonSessionId: session.id,
          status: session.status,
          exit_code: session.exit_code,
          archived_at,
          // A project-root mismatch means the daemon can no longer vouch for
          // this session's cwd/branch identity, but the local transcript still
          // captures the session's terminal state well enough to normalize
          // attention — except for daemon `archived`, which is an archive
          // boundary even before archived_at is stamped.
          attention,
          initiator: session.initiator ?? recovered.initiator,
        };
        if (visibleSession(row, state, includeArchived)) rows.push(row);
      }
      continue;
    }
    seen.add(stateSessionId);
    const titleOverride = state.sessionTitles[stateSessionId];
    const archivedLocal = state.sessionArchived[stateSessionId] ?? null;
    const keep = Boolean(state.sessionKeep?.[stateSessionId]);
    const pinned = Boolean(state.sessionPinned?.[stateSessionId]);
    const extendedUntil = state.sessionArchiveExtendedUntil?.[stateSessionId] ?? null;
    const archived_at = archivedLocal ?? session.archived_at;
    const localUpdatedAt = local?.updatedAt ?? localUpdatedById.get(session.id);
    const familiarId = state.sessionFamiliar[stateSessionId] ?? local?.familiarId ?? null;
    const localIsNewer =
      localUpdatedAt != null &&
      Number.isFinite(Date.parse(localUpdatedAt)) &&
      Number.isFinite(Date.parse(session.updated_at)) &&
      Date.parse(localUpdatedAt) > Date.parse(session.updated_at);
    const daemonStatusIsAuthoritative = isDaemonAuthoritativeStatus(session.status);
    const mergedStatus =
      localIsNewer && !daemonStatusIsAuthoritative && local?.status
        ? local.status
        : session.status;
    const attention =
      isArchivedStatus(mergedStatus)
        ? NO_CHAT_ATTENTION
        : deriveChatAttention({
            evidence: local?.attentionEvidence,
            status: mergedStatus,
            archivedAt: archived_at,
            now,
          });
    const row: SessionRow = {
      ...session,
      daemonSessionId: session.id,
      ...(local && local.sessionId !== session.id ? { id: local.sessionId } : {}),
      ...(localUpdatedAt ? { updated_at: localUpdatedAt } : {}),
      // Cave conversations record the concrete runtime selected for the chat
      // (`local:<cwd>` or `ssh:<host>:<cwd>`). That send-time provenance is
      // authoritative for model inventory scoping; a daemon row may omit it or
      // retain the pre-transition runtime, so never let the merge erase it.
      ...(local?.runtime ? { runtime: local.runtime } : {}),
      ...(localIsNewer && !daemonStatusIsAuthoritative && local?.status ? { status: local.status } : {}),
      // A local summary with no status (a first-turn stub whose reply is still
      // streaming) must contribute neither status nor exit_code — the daemon's
      // live "running" row stays untouched.
      ...(localIsNewer && !daemonStatusIsAuthoritative && local?.status ? { exit_code: local.exitCode ?? 0 } : {}),
      // Daemon titles derive from the harness prompt, which the chat route
      // prefixes with the identity canon — sanitize so the preamble never
      // surfaces as a session title.
      title:
        titleOverride ??
        sanitizeSessionTitle(session.title) ??
        defaultChatTitleForSession(session.id),
      archived_at,
      attention,
      attentionAfterOperationId: attentionAfterOperationId(local?.attentionEvidence),
      ...attentionOperationLineageFields(local?.attentionEvidence),
      // A Cave conversation records real provenance at send time; harness/
      // title inference is only the fallback for daemon-only sessions.
      origin: local?.origin ?? inferOrigin(session),
      // Per-session branch snapshot (chat's own cwd at its last saved turn).
      // PR attribution must key off this — never the root's current branch.
      ...(local?.branch ? { workBranch: local.branch } : {}),
      // Transcript-reported PR URL — badge fallback when the chat's own cwd
      // never sat on the PR branch (familiar chats working via worktrees).
      ...(local?.prUrl ? { chatPrUrl: local.prUrl } : {}),
      // No conversation + nothing better than the inferred-"chat" default =
      // a run some generator spawned (journal narrative, flow, automation,
      // CLI), not something a person typed into a chat surface.
      ...(!local && inferOrigin(session) === "chat" ? { generated: true } : {}),
      ...(local ? { hasLocalConversation: true } : {}),
      ...(keep ? { keep: true } : {}),
      ...(pinned ? { pinned: true } : {}),
      ...(extendedUntil ? { archive_extended_until: extendedUntil } : {}),
      familiarId,
      initiator: session.initiator ?? initiatorFromSessionKey("", familiarId ?? session.harness),
    };
    if (visibleSession(row, state, includeArchived)) rows.push(row);
  }

  for (const local of localConversations) {
    const primarySessionId = primaryDaemonSessionIdByLocalId.get(local.sessionId);
    const parentRow = localConversationToSession(local, state, projectRootForCwd, now);
    const archivedAt = parentRow.archived_at;
    for (const [replayIndex, replay] of conversationReplaySessions(local).entries()) {
      if (replay.sessionId === primarySessionId) continue;
      const daemon = daemonSessions.find((session) => session.id === replay.sessionId);
      if (!daemon) continue;
      const title = linkedReplayTitle(local, replay, replayIndex + 1);
      const row: SessionRow = {
        ...parentRow,
        id: replay.sessionId,
        daemonSessionId: daemon.id,
        project_root: daemon.project_root,
        harness: daemon.harness,
        title,
        status: daemon.status,
        exit_code: daemon.exit_code,
        archived_at: archivedAt,
        created_at: daemon.created_at,
        updated_at: daemon.updated_at,
        attention: NO_CHAT_ATTENTION,
      };
      if (visibleSession(row, state, includeArchived)) rows.push(row);
    }
  }

  for (const row of localConversations
    .map((conv) => localConversationToSession(conv, state, projectRootForCwd, now))
    .filter((session) => visibleSession(session, state, includeArchived))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))) {
    if (seen.has(row.id)) continue;
    rows.push(row);
  }

  return rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}
