import type { CaveState } from "./cave-config.ts";
import {
  defaultChatTitleForSession,
  sanitizeSessionTitle,
} from "./cave-chat-titles.ts";
import { initiatorFromSessionKey } from "./session-initiator.ts";
import { inferOrigin } from "./session-origin.ts";
import type { SessionInitiator, SessionOrigin, SessionRow } from "./types.ts";

export type DaemonSessionRow = Omit<SessionRow, "familiarId" | "origin">;

export type LocalConversationSummary = {
  sessionId: string;
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
};

type MergeOptions = {
  daemonSessions: DaemonSessionRow[];
  localConversations: LocalConversationSummary[];
  state: CaveState;
  includeArchived: boolean;
  isValidDaemonProjectRoot?: (projectRoot: string) => boolean;
};

function localConversationToSession(
  conv: LocalConversationSummary,
  state: CaveState,
): SessionRow {
  const title =
    state.sessionTitles[conv.sessionId] ?? sanitizeSessionTitle(conv.title) ?? "Chat";
  const familiarId = state.sessionFamiliar[conv.sessionId] ?? conv.familiarId ?? null;
  const status = conv.status ?? "completed";
  return {
    id: conv.sessionId,
    project_root: "",
    harness: conv.harness ?? "chat",
    ...(conv.model ? { model: conv.model } : {}),
    ...(conv.runtime ? { runtime: conv.runtime } : {}),
    title,
    status,
    exit_code: conv.exitCode ?? (status === "failed" || status === "error" ? 1 : 0),
    archived_at: state.sessionArchived[conv.sessionId] ?? null,
    created_at: conv.createdAt ?? conv.updatedAt,
    updated_at: conv.updatedAt,
    familiarId,
    origin: conv.origin ?? "chat",
    initiator: conv.initiator ?? { kind: "human", label: "Cave user", channel: "cave" },
  };
}

function visibleSession(row: SessionRow, state: CaveState, includeArchived: boolean): boolean {
  if (state.sessionSacrificed[row.id]) return false;
  return includeArchived || !row.archived_at;
}

export function localConversationSessionRows(
  localConversations: LocalConversationSummary[],
  state: CaveState,
  includeArchived: boolean,
): SessionRow[] {
  return localConversations
    .map((conv) => localConversationToSession(conv, state))
    .filter((row) => visibleSession(row, state, includeArchived))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function mergeSessionRows({
  daemonSessions,
  localConversations,
  state,
  includeArchived,
  isValidDaemonProjectRoot,
}: MergeOptions): SessionRow[] {
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
  for (const conv of localConversations) {
    if (conv.updatedAt) {
      localUpdatedById.set(conv.sessionId, conv.updatedAt);
      localById.set(conv.sessionId, conv);
    }
  }

  for (const session of daemonSessions) {
    if (isValidDaemonProjectRoot && !isValidDaemonProjectRoot(session.project_root)) {
      continue;
    }
    seen.add(session.id);
    const titleOverride = state.sessionTitles[session.id];
    const archivedLocal = state.sessionArchived[session.id] ?? null;
    const archived_at = archivedLocal ?? session.archived_at;
    const localUpdatedAt = localUpdatedById.get(session.id);
    const local = localById.get(session.id);
    const localIsNewer =
      localUpdatedAt != null &&
      Number.isFinite(Date.parse(localUpdatedAt)) &&
      Number.isFinite(Date.parse(session.updated_at)) &&
      Date.parse(localUpdatedAt) > Date.parse(session.updated_at);
    const row: SessionRow = {
      ...session,
      ...(localUpdatedAt ? { updated_at: localUpdatedAt } : {}),
      ...(localIsNewer && local?.status ? { status: local.status } : {}),
      ...(localIsNewer && local ? { exit_code: local.exitCode ?? 0 } : {}),
      // Daemon titles derive from the harness prompt, which the chat route
      // prefixes with the identity canon — sanitize so the preamble never
      // surfaces as a session title.
      title:
        titleOverride ??
        sanitizeSessionTitle(session.title) ??
        defaultChatTitleForSession(session.id),
      archived_at,
      familiarId: state.sessionFamiliar[session.id] ?? null,
      // A Cave conversation records real provenance at send time; harness/
      // title inference is only the fallback for daemon-only sessions.
      origin: local?.origin ?? inferOrigin(session),
      // No conversation + nothing better than the inferred-"chat" default =
      // a run some generator spawned (journal narrative, flow, automation,
      // CLI), not something a person typed into a chat surface.
      ...(!local && inferOrigin(session) === "chat" ? { generated: true } : {}),
      initiator:
        session.initiator ??
        initiatorFromSessionKey("", state.sessionFamiliar[session.id] ?? session.harness),
    };
    if (visibleSession(row, state, includeArchived)) rows.push(row);
  }

  for (const row of localConversationSessionRows(localConversations, state, includeArchived)) {
    if (seen.has(row.id)) continue;
    rows.push(row);
  }

  return rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}
