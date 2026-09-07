import type { InboxItem, NewItemInput } from "@/lib/cave-inbox";

/**
 * Session-finished notification (cave-fgey): when a familiar's session
 * completes while the user isn't watching that chat, land one 'agent' inbox
 * item ("<familiar> finished: <session title>") linking back to the chat, so
 * finished long-running work is not silent outside Recent Activity. The item
 * fires immediately (kind 'agent', no fireAt) and rides the existing
 * "Needs you" strip / bell badge for free.
 *
 * `auto` on the inbox item is the durable discriminator: it marks the item as
 * machine-generated so producers can dedup and resolve their own items without
 * brittle title matching (same convention as task-archive-nudge.ts). Human/user
 * reminders never set it.
 */
export const SESSION_FINISHED_AUTO = "session-finished";

/**
 * A turn that ran longer than this is treated as "the user has wandered",
 * even when their tab is still open on the chat. Default 3 minutes, floored
 * at 1 minute, overridable via COVEN_CAVE_SESSION_FINISHED_MIN_MS — same
 * env-shape as the chat detach cap (CHAT_DETACH_MAX_MS).
 */
export const SESSION_FINISHED_NOTIFY_MIN_MS = Math.max(
  60_000,
  Number(process.env.COVEN_CAVE_SESSION_FINISHED_MIN_MS ?? 3 * 60_000) || 3 * 60_000,
);

/**
 * Whether a finished turn should surface an inbox item. The user is watching
 * the chat AND the turn was short → silent; otherwise notify. `durationMs`
 * null/undefined (unknown duration) falls back to the watched flag alone.
 */
export function shouldNotifySessionFinished(opts: {
  watchedByUser: boolean;
  durationMs: number | null | undefined;
}): boolean {
  if (opts.durationMs != null && opts.durationMs > SESSION_FINISHED_NOTIFY_MIN_MS) {
    return true;
  }
  return !opts.watchedByUser;
}

/**
 * Build the inbox payload for a finished session. Pure — no IO, never dedups;
 * callers gate creation with {@link hasUnresolvedSessionFinishedItem}.
 */
export function sessionFinishedItem(input: {
  familiarId: string;
  familiarName: string;
  sessionTitle: string;
  sessionId: string;
}): NewItemInput {
  return {
    kind: "agent",
    title: `${input.familiarName} finished: ${input.sessionTitle}`,
    source: "agent",
    familiarId: input.familiarId,
    sessionId: input.sessionId,
    link: { kind: "session", ref: input.sessionId },
    auto: SESSION_FINISHED_AUTO,
  };
}

/** Statuses that mean the item no longer demands the user's attention. */
const RESOLVED: ReadonlyArray<InboxItem["status"]> = ["done", "dismissed"];

/**
 * True when `item` is a session-finished item. When `sessionId` is supplied,
 * also requires the item to target that session (matched on either the item's
 * `sessionId` or its session link ref).
 */
export function isSessionFinishedItem(item: InboxItem, sessionId?: string): boolean {
  if (item.auto !== SESSION_FINISHED_AUTO) return false;
  if (sessionId == null) return true;
  return item.sessionId === sessionId || item.link?.ref === sessionId;
}

/**
 * Whether an unresolved session-finished item already exists for `sessionId`.
 * "Deduped per session": one outstanding item per session — a second
 * completion for the same chat does not stack while the user hasn't acted,
 * but a fresh notification can surface after the previous one was handled.
 */
export function hasUnresolvedSessionFinishedItem(
  items: InboxItem[],
  sessionId: string,
): boolean {
  return items.some(
    (item) => isSessionFinishedItem(item, sessionId) && !RESOLVED.includes(item.status),
  );
}
