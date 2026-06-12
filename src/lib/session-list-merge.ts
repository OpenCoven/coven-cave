import type { CaveState } from "./cave-config.ts";
import {
  defaultChatTitleForSession,
  sanitizeSessionTitle,
} from "./cave-chat-titles.ts";
import { initiatorFromSessionKey } from "./session-initiator.ts";
import { inferOrigin } from "./session-origin.ts";
import type { SessionInitiator, SessionRow } from "./types.ts";

export type DaemonSessionRow = Omit<SessionRow, "familiarId" | "origin">;

export type LocalConversationSummary = {
  sessionId: string;
  familiarId: string;
  harness?: string;
  model?: string;
  runtime?: string;
  title?: string;
  createdAt?: string;
  updatedAt: string;
  initiator?: SessionInitiator;
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
  return {
    id: conv.sessionId,
    project_root: "",
    harness: conv.harness ?? "chat",
    ...(conv.model ? { model: conv.model } : {}),
    ...(conv.runtime ? { runtime: conv.runtime } : {}),
    title,
    status: "completed",
    exit_code: 0,
    archived_at: state.sessionArchived[conv.sessionId] ?? null,
    created_at: conv.createdAt ?? conv.updatedAt,
    updated_at: conv.updatedAt,
    familiarId,
    origin: "chat",
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

  for (const session of daemonSessions) {
    if (isValidDaemonProjectRoot && !isValidDaemonProjectRoot(session.project_root)) {
      continue;
    }
    seen.add(session.id);
    const titleOverride = state.sessionTitles[session.id];
    const archivedLocal = state.sessionArchived[session.id] ?? null;
    const archived_at = archivedLocal ?? session.archived_at;
    const row: SessionRow = {
      ...session,
      // Daemon titles derive from the harness prompt, which the chat route
      // prefixes with the identity canon — sanitize so the preamble never
      // surfaces as a session title.
      title:
        titleOverride ??
        sanitizeSessionTitle(session.title) ??
        defaultChatTitleForSession(session.id),
      archived_at,
      familiarId: state.sessionFamiliar[session.id] ?? null,
      origin: inferOrigin(session),
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
