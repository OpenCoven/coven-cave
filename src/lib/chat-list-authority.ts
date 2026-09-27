import type { SessionRow } from "./types.ts";

/**
 * Whether the chat list can be trusted as the complete set of chats for its
 * scope. `sessionsLoaded` only says the first request settled — a failed or
 * degraded (daemon unreachable, local rows only) response settles it too, and
 * treating that as the full list deleted restored split panes and cleared
 * `#chat-` deep links (#5563).
 */

export const SESSIONS_POLL_MS = 4_000;
const SESSIONS_POLL_MAX_MS = 30_000;

/** Poll interval after `failureStreak` consecutive failed list loads. */
export function sessionsPollIntervalMs(failureStreak: number): number {
  if (!Number.isFinite(failureStreak) || failureStreak <= 0) return SESSIONS_POLL_MS;
  const exponent = Math.min(Math.floor(failureStreak), 4);
  return Math.min(SESSIONS_POLL_MS * 2 ** exponent, SESSIONS_POLL_MAX_MS);
}

/**
 * A degraded response carries only the rows Cave could read locally. Keep the
 * previous rows it omits (daemon-originated chats) so they don't vanish and
 * reappear when the daemon comes back.
 */
export function mergeDegradedSessionList(
  previous: readonly SessionRow[],
  degraded: readonly SessionRow[],
): SessionRow[] {
  const present = new Set(degraded.map((row) => row.id));
  const retained = previous.filter((row) => !present.has(row.id));
  return retained.length === 0 ? [...degraded] : [...degraded, ...retained];
}

export type ChatDeepLinkResolution =
  | { kind: "open"; familiarId: string | null }
  | { kind: "missing" };

type ConversationLookup = (sessionId: string) => Promise<{
  ok?: boolean;
  conversation?: unknown;
} | null>;

function conversationFamiliarId(conversation: unknown): string | null {
  if (!conversation || typeof conversation !== "object") return null;
  const familiarId = (conversation as { familiarId?: unknown }).familiarId;
  return typeof familiarId === "string" && familiarId ? familiarId : null;
}

/**
 * Resolve a `#chat-<id>` target. The loaded list is scoped to the active
 * familiar and can be failed or partial, so a miss there is not proof the chat
 * is gone: ask the conversation endpoint. Only a 404 means missing; any other
 * failure still opens the chat, whose view has its own error and Retry state.
 */
export async function resolveChatDeepLink(
  sessionId: string,
  sessions: readonly Pick<SessionRow, "id" | "familiarId">[],
  lookup: ConversationLookup,
): Promise<ChatDeepLinkResolution> {
  const listed = sessions.find((session) => session.id === sessionId);
  if (listed) return { kind: "open", familiarId: listed.familiarId ?? null };
  try {
    const payload = await lookup(sessionId);
    if (!payload || payload.ok === false) return { kind: "missing" };
    return { kind: "open", familiarId: conversationFamiliarId(payload.conversation) };
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 404) return { kind: "missing" };
    return { kind: "open", familiarId: null };
  }
}

/**
 * Copy for a list that has rows but is not current. The empty-list failure has
 * its own full state; this is the non-blocking line above existing rows, which
 * previously gave no sign the list had stopped refreshing.
 */
export function chatListStaleNotice(input: {
  sessionsError: boolean;
  sessionsDegraded: boolean;
  hasRows: boolean;
}): string | null {
  if (!input.hasRows) return null;
  if (input.sessionsError) return "Couldn't refresh chats. Showing the last list.";
  if (input.sessionsDegraded) return "Coven isn't reachable. Showing chats saved on this device.";
  return null;
}
